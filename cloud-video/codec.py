"""Biu V2 experimental carrier. Never writes into the live player library."""
import argparse
import base64
import ctypes as C
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
import random
import struct
import subprocess
import tempfile
import time
import uuid
import zlib

import numpy as np
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = Path(__file__).resolve().parent
BLOCK = 96
HEADER = struct.Struct('<4sBBH16sIIII')
GROUP_BLOCKS = 1024
PROFILE = 1  # pinned Wirehair sources from yt-media-storage 70dd531


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def js(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()


def atomic(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix='.pending-')
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def normalize(library):
    # The main process validates the library before encoding and after decoding.
    require(isinstance(library,dict) and library.get('version')==1,'unsupported library')
    return js(library)


def seal(library, key, parents=(), device_id='biu-video-cloud'):
    raw = normalize(library)
    metadata = dict(version=2, deviceId=device_id, parents=list(parents),
        createdAt=time.time(), librarySha256=sha(raw), libraryBytes=len(raw),
        library=json.loads(raw))
    nonce = os.urandom(12)
    payload = b'BIU2' + nonce + AESGCM(key).encrypt(nonce, gzip.compress(js(metadata)), b'biu-video-v2')
    require(len(payload) >= 192, 'invalid snapshot size')
    return payload, metadata


def unseal(payload, key):
    require(payload[:4] == b'BIU2', 'invalid encrypted envelope')
    compressed = AESGCM(key).decrypt(payload[4:16], payload[16:], b'biu-video-v2')
    d = zlib.decompressobj(31)
    plain = d.decompress(compressed)
    require(d.eof and not d.unused_data, 'invalid gzip')
    text = plain.decode('utf-8')
    meta = json.loads(text)
    require(meta.get('version') == 2 and isinstance(meta.get('parents'), list), 'invalid snapshot metadata')
    normalize(meta['library'])
    # Verify the bytes that were signed, not Python's reformatting of JS floats.
    decoder = json.JSONDecoder()
    at = len(text) - len(text.lstrip())
    require(text[at:at+1] == '{', 'invalid snapshot metadata')
    at += 1
    raw = None
    seen = set()
    while True:
        while at < len(text) and text[at].isspace():
            at += 1
        if text[at:at+1] == '}':
            break
        name, at = decoder.raw_decode(text, at)
        require(isinstance(name, str) and name not in seen, 'duplicate snapshot field')
        seen.add(name)
        while at < len(text) and text[at].isspace():
            at += 1
        require(text[at:at+1] == ':', 'invalid snapshot metadata')
        at += 1
        while at < len(text) and text[at].isspace():
            at += 1
        start = at
        _, at = decoder.raw_decode(text, at)
        if name == 'library':
            raw = text[start:at].encode('utf-8')
        while at < len(text) and text[at].isspace():
            at += 1
        if text[at:at+1] == '}':
            break
        require(text[at:at+1] == ',', 'invalid snapshot metadata')
        at += 1
    require(raw is not None, 'missing snapshot library')
    require(len(raw) == meta['libraryBytes'] and sha(raw) == meta['librarySha256'], 'JSON integrity mismatch')
    return raw, meta


def wirehair():
    lib = C.CDLL(os.environ['BIU_WIREHAIR'])
    lib.wirehair_init_.argtypes = [C.c_int]
    lib.wirehair_encoder_create.argtypes = [C.c_void_p, C.c_void_p, C.c_uint64, C.c_uint32]
    lib.wirehair_encoder_create.restype = C.c_void_p
    lib.wirehair_decoder_create.argtypes = [C.c_void_p, C.c_uint64, C.c_uint32]
    lib.wirehair_decoder_create.restype = C.c_void_p
    lib.wirehair_encode.argtypes = [C.c_void_p, C.c_uint32, C.c_void_p, C.c_uint32, C.POINTER(C.c_uint32)]
    lib.wirehair_decode.argtypes = [C.c_void_p, C.c_uint32, C.c_void_p, C.c_uint32]
    lib.wirehair_recover.argtypes = [C.c_void_p, C.c_void_p, C.c_uint64]
    lib.wirehair_free.argtypes = [C.c_void_p]
    require(lib.wirehair_init_(2) == 0, 'Wirehair init failed')
    return lib


def packetize(payload, block=BLOCK, profile=PROFILE):
    lib = wirehair()
    count = max(2, math.ceil(len(payload) / block))
    # BQ03 splits a large snapshot into independent fountain groups. BQ02 remains readable.
    version = 3 if count > 900 else 2
    group_size = GROUP_BLOCKS if version == 3 else count
    message = payload.ljust(count * block, b'\0')
    sid = hashlib.sha256(payload).digest()[:16]
    packets = []
    for start in range(0, count, group_size):
        n = min(group_size, count - start)
        part = message[start * block:(start + n) * block]
        # Wirehair requires at least two source blocks, including the final one-block group.
        part = part.ljust(max(2, n) * block, b'\0')
        codec = lib.wirehair_encoder_create(None, part, len(part), block)
        require(codec, 'Wirehair encoder initialization failed')
        try:
            for local_index in range(n * 2):
                out, written = C.create_string_buffer(block), C.c_uint32()
                require(lib.wirehair_encode(codec, 2 if n == 1 and local_index == 1 else local_index, out, block, C.byref(written)) == 0, 'Wirehair encode failed')
                require(written.value == block, 'unexpected symbol size')
                index = start * 2 + local_index
                header = HEADER.pack(b'BQ03' if version == 3 else b'BQ02', version, profile, block, sid, index, count, len(payload), 0)
                crc = zlib.crc32(header + out.raw)
                packets.append(header[:-4] + struct.pack('<I', crc) + out.raw)
        finally:
            lib.wirehair_free(codec)
    random.Random(20260904).shuffle(packets)
    return packets


def parse(packet, block=BLOCK, profile=PROFILE):
    if len(packet) != HEADER.size + block:
        return None
    magic, version, packet_profile, size, sid, index, count, length, crc = HEADER.unpack_from(packet)
    if zlib.crc32(packet[:36] + b'\0'*4 + packet[40:]) != crc:
        return None
    require(((magic == b'BQ02' and version == 2) or (magic == b'BQ03' and version == 3)) and packet_profile == profile and size == block, 'unsupported packet format')
    require(192 <= length and count == max(2, math.ceil(length / block)), 'invalid packet bounds')
    require(index < count * 2, 'invalid symbol index')
    return (sid, count, length, version), index, packet[40:]


def recover(packets, expected=None, block=BLOCK, profile=PROFILE):
    groups, symbols = set(), {}
    for packet in packets:
        item = parse(packet, block, profile)
        if not item:
            continue
        group, index, data = item
        groups.add(group)
        require(len(groups) == 1, 'mixed snapshots or contradictory headers')
        if expected:
            require(group[0].hex() == expected, 'unexpected snapshot')
        require(index not in symbols or symbols[index] == data, 'conflicting duplicate symbol')
        symbols[index] = data
    require(groups, 'no valid carrier packets found')
    sid, count, length, version = next(iter(groups))
    require(len(symbols) >= count, f'insufficient symbols: {len(symbols)}/{count}')
    lib = wirehair()
    group_size = GROUP_BLOCKS if version == 3 else count
    recovered = bytearray()
    for start in range(0, count, group_size):
        n = min(group_size, count - start)
        codec = lib.wirehair_decoder_create(None, max(2, n) * block, block)
        require(codec, 'Wirehair decoder initialization failed')
        success = False
        try:
            if n == 1:
                require(lib.wirehair_decode(codec, 1, b'\0' * block, block) == 1, 'padding initialization failed')
            for index, data in symbols.items():
                if not start * 2 <= index < (start + n) * 2:
                    continue
                local_index = index - start * 2
                status = lib.wirehair_decode(codec, 2 if n == 1 and local_index == 1 else local_index, data, block)
                require(status in (0, 1), f'Wirehair decode error {status}')
                if status == 0:
                    success = True
                    break
            require(success, 'not enough independent symbols')
            out = C.create_string_buffer(max(2, n) * block)
            require(lib.wirehair_recover(codec, out, len(out)) == 0, 'Wirehair recovery failed')
            recovered.extend(out.raw[:n * block])
        finally:
            lib.wirehair_free(codec)
    payload = bytes(recovered[:length])
    require(hashlib.sha256(payload).digest()[:16] == sid, 'ciphertext hash mismatch')
    return payload, len(symbols)
