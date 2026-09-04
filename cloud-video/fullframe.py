"""Full-frame binary carrier, profile 2. 128x72 modules, 360p = 5px/module."""
import argparse
import base64
import json
import math
import os
from pathlib import Path
import subprocess

import numpy as np
from PIL import Image
from reedsolo import RSCodec, ReedSolomonError
import codec

BLOCK = 704
PROFILE = 2
WIDTH, HEIGHT = 128, 72
RS = RSCodec(64)  # Four RS(255,191) words, up to 32 erroneous bytes per word.
PACKET_BYTES = 40 + BLOCK


def layout():
    yy, xx = np.indices((HEIGHT, WIDTH))
    pilots = (xx + yy) % 2 == 0
    reserved = (xx == 0) | (xx == WIDTH-1) | (yy == 0) | (yy == HEIGHT-1)
    for x,y in [(1,1),(WIDTH-10,1),(1,HEIGHT-10),(WIDTH-10,HEIGHT-10)]:
        reserved[y:y+9,x:x+9] = True
        marker = np.ones((9,9),dtype=bool)
        marker[1:8,1:8] = False
        marker[2:7,2:7] = True
        marker[3:6,3:6] = False
        pilots[y:y+9,x:x+9] = marker
    return pilots, reserved, (xx + yy) % 2 == 0


PILOTS, RESERVED, MASK = layout()


def render(packet):
    codec.require(len(packet) == PACKET_BYTES, 'invalid fullframe packet length')
    padded = packet.ljust(4*191,b'\0')
    words = [np.frombuffer(bytes(RS.encode(padded[i*191:(i+1)*191])),dtype=np.uint8) for i in range(4)]
    # Column interleave spreads localized image damage over the four RS words.
    stream = np.stack(words).T.flatten()
    bits = np.unpackbits(stream).astype(bool)
    grid = PILOTS.copy()
    grid[~RESERVED] = np.resize(bits, np.count_nonzero(~RESERVED)) ^ MASK[~RESERVED]
    return Image.fromarray(np.repeat(np.repeat(grid.astype(np.uint8)*255,15,0),15,1))


def read(pixels):
    levels = pixels.reshape(HEIGHT,5,WIDTH,5)[:,1:4,:,1:4].mean(axis=(1,3))
    dark,light = np.quantile(levels,[.1,.9])
    if light-dark < 80:
        return []
    grid = levels > (dark+light)/2
    if np.mean(grid[RESERVED] != PILOTS[RESERVED]) > .15:
        return []
    bits = (grid[~RESERVED] ^ MASK[~RESERVED])[:4*255*8]
    words = np.packbits(bits).reshape(255,4).T
    try:
        decoded = b''.join(bytes(RS.decode(bytes(word))[0]) for word in words)
    except ReedSolomonError:
        return []
    return [decoded[:PACKET_BYTES]]

