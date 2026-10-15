#!/bin/sh
# Disposable: logo near the 1 MB cap, as a byte-array literal on stdin vs a file under --root (clinic data only).
set -e
apk add --no-cache -q time >/dev/null
mkdir -p /tmp/r /tmp/empty
node -e '
const { randomBytes } = require("node:crypto");
const { deflateSync } = require("node:zlib");
const fs = require("node:fs");
function crc32(b){let c,r=0xffffffff;for(const x of b){c=(r^x)&255;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;r=(r>>>8)^c;}return(r^0xffffffff)>>>0;}
function chunk(t,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc32(td));return Buffer.concat([l,td,c]);}
const w=580,h=580,noise=randomBytes(w*h*3),raw=Buffer.alloc((w*3+1)*h);
for(let y=0;y<h;y++)noise.copy(raw,y*(w*3+1)+1,y*w*3,(y+1)*w*3);
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr.set([8,2,0,0,0],8);
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",ihdr),chunk("IDAT",deflateSync(raw)),chunk("IEND",Buffer.alloc(0))]);
fs.writeFileSync("/tmp/r/logo.png",png);
fs.writeFileSync("/dev/shm/array.typ","#image(bytes(("+[...png].join(",")+")), width: 40mm)\nبيانات تجريبية");
fs.writeFileSync("/dev/shm/file.typ","#image(\"/logo.png\", width: 40mm)\nبيانات تجريبية");
console.log("png_bytes="+png.length);'
for i in 1 2 3; do printf "array: "; /usr/bin/time -f "rss_kb=%M elapsed_s=%e exit=%x" /opt/typst/typst compile --format pdf --ignore-system-fonts --font-path /fonts --root /tmp/empty - - < /dev/shm/array.typ > /dev/null; done
for i in 1 2 3; do printf "file:  "; /usr/bin/time -f "rss_kb=%M elapsed_s=%e exit=%x" /opt/typst/typst compile --format pdf --ignore-system-fonts --font-path /fonts --root /tmp/r - - < /dev/shm/file.typ > /dev/null; done
rm -f /dev/shm/array.typ /dev/shm/file.typ
