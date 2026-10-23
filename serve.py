"""Local static preview with gzip, cache validation, and video byte ranges."""
import argparse
import datetime
from email.utils import parsedate_to_datetime
from functools import lru_cache, partial
import gzip
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import io
import os
from pathlib import Path
import re
from urllib.parse import parse_qs, urlsplit


TEXT_SUFFIXES = {'.html', '.htm', '.css', '.js', '.mjs', '.json', '.svg', '.txt', '.xml', '.webmanifest'}
CACHEABLE_SUFFIXES = {'.css', '.js', '.mjs', '.json', '.svg', '.webp', '.png', '.jpg', '.jpeg',
                      '.gif', '.avif', '.ico', '.mp4', '.webm', '.mp3', '.ogg', '.woff', '.woff2'}
IMMUTABLE = 'public, max-age=31536000, immutable'


def cache_policy(url, path):
    """HTML and unversioned imports always revalidate; only versioned assets are immutable."""
    versions = parse_qs(urlsplit(url).query).get('v', [])
    query_version = len(versions) == 1 and re.fullmatch(r'[A-Za-z0-9._-]+', versions[0])
    name_version = re.search(r'\.mobile-v[0-9]+\.(?:webm|mp4|webp)$', path.name, re.I)
    return IMMUTABLE if path.suffix.lower() in CACHEABLE_SUFFIXES and (query_version or name_version) else 'no-cache'


def encoding_quality(header):
    values = {}
    for item in header.split(','):
        parts = [part.strip() for part in item.split(';')]
        coding = parts[0].lower()
        if not coding:
            continue
        quality = 1.0
        for parameter in parts[1:]:
            key, separator, value = parameter.partition('=')
            if separator and key.strip().lower() == 'q':
                try:
                    quality = float(value)
                    if not 0 <= quality <= 1:
                        quality = 0
                except ValueError:
                    quality = 0
        values[coding] = max(values.get(coding, 0), quality)
    gzip_quality = values.get('gzip', values.get('*', 0))
    identity_quality = values.get('identity', 0 if values.get('*') == 0 else 1)
    return gzip_quality, identity_quality


def date_matches(header, modified):
    try:
        value = parsedate_to_datetime(header)
        if value.tzinfo is None:
            value = value.replace(tzinfo=datetime.timezone.utc)
        return int(modified) <= value.timestamp()
    except (TypeError, ValueError, OverflowError):
        return False


@lru_cache(maxsize=128)
def compressed_file(path, modified_ns, size):
    # Stat values invalidate the small text cache as soon as a source file changes.
    return gzip.compress(Path(path).read_bytes(), compresslevel=6, mtime=0)


class VideoHandler(SimpleHTTPRequestHandler):
    def send_response(self, code, message=None):
        self.response_status = code
        super().send_response(code, message)

    def end_headers(self):
        policy = getattr(self, 'file_cache_policy', 'no-cache')
        self.send_header('Cache-Control', policy if self.response_status in (200, 206, 304) else 'no-store')
        if getattr(self, 'vary_encoding', False):
            self.send_header('Vary', 'Accept-Encoding')
        super().end_headers()

    def file_headers(self, stat, etag):
        self.send_header('ETag', etag)
        self.send_header('Last-Modified', self.date_time_string(stat.st_mtime))

    def send_head(self):
        self.byte_range = None
        self.file_cache_policy = 'no-cache'
        self.vary_encoding = False
        path = Path(self.translate_path(self.path))
        if path.is_dir():
            if not urlsplit(self.path).path.endswith('/'):
                return super().send_head()
            for name in ('index.html', 'index.htm'):
                if (path / name).is_file():
                    path = path / name
                    break
            else:
                return super().send_head()
        try:
            stream = path.open('rb')
            stat = os.fstat(stream.fileno())
        except OSError:
            self.send_error(404, 'File not found')
            return None

        self.file_cache_policy = cache_policy(self.path, path)
        self.vary_encoding = path.suffix.lower() in TEXT_SUFFIXES
        gzip_quality, identity_quality = encoding_quality(self.headers.get('Accept-Encoding', ''))
        requested_range = self.headers.get('Range')
        # Byte ranges address the unchanged identity representation, never gzip bytes.
        use_gzip = self.vary_encoding and gzip_quality > 0 and gzip_quality >= identity_quality
        if requested_range and identity_quality > 0:
            use_gzip = False
        if not use_gzip and identity_quality <= 0:
            stream.close()
            self.send_error(406, 'No acceptable content encoding')
            return None

        encoding = 'gzip' if use_gzip else 'identity'
        # Weak validators avoid claiming a stat-derived value is a byte-content hash.
        # Encoding is included so identity and gzip caches cannot validate each other.
        etag = f'W/"{stat.st_mtime_ns:x}-{stat.st_size:x}-{encoding}"'
        none_match = self.headers.get('If-None-Match')
        if none_match is not None:
            matches = any(value.strip() == '*' or value.strip().removeprefix('W/') == etag.removeprefix('W/')
                          for value in none_match.split(','))
        else:
            matches = date_matches(self.headers.get('If-Modified-Since'), stat.st_mtime)
        if matches:
            stream.close()
            self.send_response(304)
            self.file_headers(stat, etag)
            if use_gzip:
                self.send_header('Content-Encoding', 'gzip')
            self.end_headers()
            return None

        selected_range = None
        if requested_range and not use_gzip:
            if_range = self.headers.get('If-Range')
            # If-Range requires a strong ETag; our weak stat validators cannot match it.
            permitted = not if_range or (not if_range.startswith(('"', 'W/')) and date_matches(if_range, stat.st_mtime))
            match = re.fullmatch(r'bytes=(\d*)-(\d*)', requested_range.strip()) if permitted else None
            if match and any(match.groups()):
                first, last = match.groups()
                if first:
                    start = int(first)
                    end = min(int(last), stat.st_size - 1) if last else stat.st_size - 1
                else:
                    start = max(0, stat.st_size - int(last))
                    end = stat.st_size - 1
                if start >= stat.st_size or start > end:
                    stream.close()
                    self.send_response(416)
                    self.send_header('Content-Range', f'bytes */{stat.st_size}')
                    self.send_header('Content-Length', '0')
                    self.send_header('Accept-Ranges', 'bytes')
                    self.end_headers()
                    return None
                selected_range = (start, end)
            # Malformed and multipart ranges are ignored, yielding a normal full response.

        length = stat.st_size
        if use_gzip:
            stream.close()
            payload = compressed_file(str(path), stat.st_mtime_ns, stat.st_size)
            stream = io.BytesIO(payload)
            length = len(payload)
        elif selected_range:
            start, end = selected_range
            stream.seek(start)
            self.byte_range = selected_range
            length = end - start + 1

        self.send_response(206 if selected_range else 200)
        self.send_header('Content-Type', self.guess_type(str(path)))
        self.send_header('Content-Length', str(length))
        self.file_headers(stat, etag)
        if use_gzip:
            self.send_header('Content-Encoding', 'gzip')
        else:
            self.send_header('Accept-Ranges', 'bytes')
        if selected_range:
            self.send_header('Content-Range', f'bytes {start}-{end}/{stat.st_size}')
        self.end_headers()
        return stream

    def copyfile(self, source, outputfile):
        try:
            if self.byte_range is None:
                return super().copyfile(source, outputfile)
            remaining = self.byte_range[1] - self.byte_range[0] + 1
            while remaining:
                chunk = source.read(min(65536, remaining))
                if not chunk:
                    break
                outputfile.write(chunk)
                remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass  # Normal when the browser cancels a buffered video request.


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--directory', default=str(Path(__file__).resolve().parent))
    args = parser.parse_args()
    server = ThreadingHTTPServer(
        ('127.0.0.1', args.port), partial(VideoHandler, directory=args.directory)
    )
    print(f'Blue Sky: http://127.0.0.1:{args.port}/', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
