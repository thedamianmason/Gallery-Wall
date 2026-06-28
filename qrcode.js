// ─────────────────────────────────────────────────────────────
// qrcode.js — self-contained QR Code generator. No third-party
// runtime dependency and no network call: everything (Reed–Solomon
// ECC, masking, matrix layout) is computed here in the browser.
//
// Byte mode only (which covers any URL), automatic version + mask
// selection. Adapted from Project Nayuki's QR Code generator
// (MIT License, https://www.nayuki.io/page/qr-code-generator-library).
// ─────────────────────────────────────────────────────────────

(function (global) {
  "use strict";

  // Error-correction levels and their 2-bit format values (M,L,H,Q ordering).
  var ECC = { L: 0, M: 1, Q: 2, H: 3 };
  var ECC_FORMAT_BITS = [1, 0, 3, 2]; // indexed by ECC level

  // Per-version (1..40) ECC parameters, indexed [level][version]; index 0 is
  // an unused placeholder. These are the standard QR specification tables.
  var ECC_CODEWORDS_PER_BLOCK = [
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  ];
  var NUM_ERROR_CORRECTION_BLOCKS = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
  ];

  function getBit(x, i) {
    return ((x >>> i) & 1) !== 0;
  }

  function getNumRawDataModules(ver) {
    var result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var numAlign = Math.floor(ver / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (ver >= 7) result -= 36;
    }
    return result;
  }

  function getNumDataCodewords(ver, ecl) {
    return (
      Math.floor(getNumRawDataModules(ver) / 8) -
      ECC_CODEWORDS_PER_BLOCK[ecl][ver] * NUM_ERROR_CORRECTION_BLOCKS[ecl][ver]
    );
  }

  // ---- Reed–Solomon over GF(256), primitive polynomial 0x11D -------------

  function reedSolomonMultiply(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xff;
  }

  function reedSolomonComputeDivisor(degree) {
    var result = [];
    for (var i = 0; i < degree - 1; i++) result.push(0);
    result.push(1);
    var root = 1;
    for (var i = 0; i < degree; i++) {
      for (var j = 0; j < result.length; j++) {
        result[j] = reedSolomonMultiply(result[j], root);
        if (j + 1 < result.length) result[j] ^= result[j + 1];
      }
      root = reedSolomonMultiply(root, 0x02);
    }
    return result;
  }

  function reedSolomonComputeRemainder(data, divisor) {
    var result = divisor.map(function () {
      return 0;
    });
    data.forEach(function (b) {
      var factor = b ^ result.shift();
      result.push(0);
      divisor.forEach(function (coef, i) {
        result[i] ^= reedSolomonMultiply(coef, factor);
      });
    });
    return result;
  }

  // ---- The QR symbol itself ----------------------------------------------

  function QrCode(version, ecl, dataCodewords) {
    this.version = version;
    this.errorCorrectionLevel = ecl;
    this.eclFormatBits = ECC_FORMAT_BITS[ecl];
    this.size = version * 4 + 17;
    this.modules = [];
    this.isFunction = [];
    for (var i = 0; i < this.size; i++) {
      this.modules.push(new Array(this.size).fill(false));
      this.isFunction.push(new Array(this.size).fill(false));
    }

    this.drawFunctionPatterns();
    var allCodewords = this.addEccAndInterleave(dataCodewords);
    this.drawCodewords(allCodewords);

    // Pick the mask with the lowest penalty score.
    var mask = 0;
    var minPenalty = Infinity;
    for (var m = 0; m < 8; m++) {
      this.applyMask(m);
      this.drawFormatBits(m);
      var penalty = this.getPenaltyScore();
      if (penalty < minPenalty) {
        mask = m;
        minPenalty = penalty;
      }
      this.applyMask(m); // undo
    }
    this.applyMask(mask);
    this.drawFormatBits(mask);
    this.isFunction = []; // no longer needed
  }

  QrCode.prototype.setFunctionModule = function (x, y, isDark) {
    this.modules[y][x] = isDark;
    this.isFunction[y][x] = true;
  };

  QrCode.prototype.drawFunctionPatterns = function () {
    for (var i = 0; i < this.size; i++) {
      this.setFunctionModule(6, i, i % 2 === 0);
      this.setFunctionModule(i, 6, i % 2 === 0);
    }
    this.drawFinderPattern(3, 3);
    this.drawFinderPattern(this.size - 4, 3);
    this.drawFinderPattern(3, this.size - 4);

    var pos = this.getAlignmentPatternPositions();
    var n = pos.length;
    for (var i = 0; i < n; i++) {
      for (var j = 0; j < n; j++) {
        if (
          !(
            (i === 0 && j === 0) ||
            (i === 0 && j === n - 1) ||
            (i === n - 1 && j === 0)
          )
        ) {
          this.drawAlignmentPattern(pos[i], pos[j]);
        }
      }
    }
    this.drawFormatBits(0);
    this.drawVersion();
  };

  QrCode.prototype.drawFormatBits = function (mask) {
    var data = (this.eclFormatBits << 3) | mask;
    var rem = data;
    for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    var bits = ((data << 10) | rem) ^ 0x5412;

    for (var i = 0; i <= 5; i++) this.setFunctionModule(8, i, getBit(bits, i));
    this.setFunctionModule(8, 7, getBit(bits, 6));
    this.setFunctionModule(8, 8, getBit(bits, 7));
    this.setFunctionModule(7, 8, getBit(bits, 8));
    for (var i = 9; i < 15; i++) this.setFunctionModule(14 - i, 8, getBit(bits, i));

    for (var i = 0; i < 8; i++)
      this.setFunctionModule(this.size - 1 - i, 8, getBit(bits, i));
    for (var i = 8; i < 15; i++)
      this.setFunctionModule(8, this.size - 15 + i, getBit(bits, i));
    this.setFunctionModule(8, this.size - 8, true);
  };

  QrCode.prototype.drawVersion = function () {
    if (this.version < 7) return;
    var rem = this.version;
    for (var i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    var bits = (this.version << 12) | rem;
    for (var i = 0; i < 18; i++) {
      var bit = getBit(bits, i);
      var a = this.size - 11 + (i % 3);
      var b = Math.floor(i / 3);
      this.setFunctionModule(a, b, bit);
      this.setFunctionModule(b, a, bit);
    }
  };

  QrCode.prototype.drawFinderPattern = function (x, y) {
    for (var dy = -4; dy <= 4; dy++) {
      for (var dx = -4; dx <= 4; dx++) {
        var dist = Math.max(Math.abs(dx), Math.abs(dy));
        var xx = x + dx,
          yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size)
          this.setFunctionModule(xx, yy, dist !== 2 && dist !== 4);
      }
    }
  };

  QrCode.prototype.drawAlignmentPattern = function (x, y) {
    for (var dy = -2; dy <= 2; dy++)
      for (var dx = -2; dx <= 2; dx++)
        this.setFunctionModule(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  };

  QrCode.prototype.getAlignmentPatternPositions = function () {
    if (this.version === 1) return [];
    var numAlign = Math.floor(this.version / 7) + 2;
    var step =
      this.version === 32
        ? 26
        : Math.ceil((this.version * 4 + 4) / (numAlign * 2 - 2)) * 2;
    var result = [6];
    for (var p = this.size - 7; result.length < numAlign; p -= step)
      result.splice(1, 0, p);
    return result;
  };

  QrCode.prototype.addEccAndInterleave = function (data) {
    var ver = this.version,
      ecl = this.errorCorrectionLevel;
    var numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecl][ver];
    var blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecl][ver];
    var rawCodewords = Math.floor(getNumRawDataModules(ver) / 8);
    var numShortBlocks = numBlocks - (rawCodewords % numBlocks);
    var shortBlockLen = Math.floor(rawCodewords / numBlocks);

    var blocks = [];
    var rsDiv = reedSolomonComputeDivisor(blockEccLen);
    for (var i = 0, k = 0; i < numBlocks; i++) {
      var dat = data.slice(
        k,
        k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1)
      );
      k += dat.length;
      var ecc = reedSolomonComputeRemainder(dat, rsDiv);
      if (i < numShortBlocks) dat.push(0);
      blocks.push(dat.concat(ecc));
    }

    var result = [];
    for (var i = 0; i < blocks[0].length; i++) {
      blocks.forEach(function (block, j) {
        if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks)
          result.push(block[i]);
      });
    }
    return result;
  };

  QrCode.prototype.drawCodewords = function (data) {
    var i = 0;
    for (var right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < this.size; vert++) {
        for (var j = 0; j < 2; j++) {
          var x = right - j;
          var upward = ((right + 1) & 2) === 0;
          var y = upward ? this.size - 1 - vert : vert;
          if (!this.isFunction[y][x] && i < data.length * 8) {
            this.modules[y][x] = getBit(data[i >>> 3], 7 - (i & 7));
            i++;
          }
        }
      }
    }
  };

  QrCode.prototype.applyMask = function (mask) {
    for (var y = 0; y < this.size; y++) {
      for (var x = 0; x < this.size; x++) {
        var invert;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          case 7: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        }
        if (!this.isFunction[y][x] && invert)
          this.modules[y][x] = !this.modules[y][x];
      }
    }
  };

  QrCode.prototype.getPenaltyScore = function () {
    var result = 0;
    var size = this.size;
    var m = this.modules;

    for (var y = 0; y < size; y++) {
      var runColor = false,
        runLen = 0,
        hist = [0, 0, 0, 0, 0, 0, 0];
      for (var x = 0; x < size; x++) {
        if (m[y][x] === runColor) {
          runLen++;
          if (runLen === 5) result += 3;
          else if (runLen > 5) result++;
        } else {
          this.finderPenaltyAddHistory(runLen, hist);
          if (!runColor) result += this.finderPenaltyCountPatterns(hist) * 40;
          runColor = m[y][x];
          runLen = 1;
        }
      }
      result += this.finderPenaltyTerminateAndCount(runColor, runLen, hist) * 40;
    }
    for (var x = 0; x < size; x++) {
      var runColor = false,
        runLen = 0,
        hist = [0, 0, 0, 0, 0, 0, 0];
      for (var y = 0; y < size; y++) {
        if (m[y][x] === runColor) {
          runLen++;
          if (runLen === 5) result += 3;
          else if (runLen > 5) result++;
        } else {
          this.finderPenaltyAddHistory(runLen, hist);
          if (!runColor) result += this.finderPenaltyCountPatterns(hist) * 40;
          runColor = m[y][x];
          runLen = 1;
        }
      }
      result += this.finderPenaltyTerminateAndCount(runColor, runLen, hist) * 40;
    }

    for (var y = 0; y < size - 1; y++) {
      for (var x = 0; x < size - 1; x++) {
        var c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1])
          result += 3;
      }
    }

    var dark = 0;
    for (var y = 0; y < size; y++)
      for (var x = 0; x < size; x++) if (m[y][x]) dark++;
    var total = size * size;
    var k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    result += k * 10;
    return result;
  };

  QrCode.prototype.finderPenaltyCountPatterns = function (h) {
    var n = h[1];
    var core = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n;
    return (
      (core && h[0] >= n * 4 && h[6] >= n ? 1 : 0) +
      (core && h[6] >= n * 4 && h[0] >= n ? 1 : 0)
    );
  };

  QrCode.prototype.finderPenaltyTerminateAndCount = function (color, runLen, hist) {
    if (color) {
      this.finderPenaltyAddHistory(runLen, hist);
      runLen = 0;
    }
    runLen += this.size;
    this.finderPenaltyAddHistory(runLen, hist);
    return this.finderPenaltyCountPatterns(hist);
  };

  QrCode.prototype.finderPenaltyAddHistory = function (runLen, hist) {
    if (hist[0] === 0) runLen += this.size;
    hist.pop();
    hist.unshift(runLen);
  };

  // ---- Encoding entry points ---------------------------------------------

  function toUtf8Bytes(str) {
    var utf8 = unescape(encodeURIComponent(str));
    var bytes = [];
    for (var i = 0; i < utf8.length; i++) bytes.push(utf8.charCodeAt(i));
    return bytes;
  }

  function appendBits(val, len, bb) {
    for (var i = len - 1; i >= 0; i--) bb.push((val >>> i) & 1);
  }

  function encode(text, ecl) {
    if (ecl == null) ecl = ECC.M;
    var bytes = toUtf8Bytes(text);

    for (var version = 1; version <= 40; version++) {
      var capacityBits = getNumDataCodewords(version, ecl) * 8;
      var ccBits = version <= 9 ? 8 : 16; // byte-mode char-count length
      var usedBits = 4 + ccBits + bytes.length * 8;
      if (usedBits > capacityBits) continue;

      var bb = [];
      appendBits(0x4, 4, bb); // byte mode indicator
      appendBits(bytes.length, ccBits, bb);
      for (var i = 0; i < bytes.length; i++) appendBits(bytes[i], 8, bb);

      appendBits(0, Math.min(4, capacityBits - bb.length), bb); // terminator
      appendBits(0, (8 - (bb.length % 8)) % 8, bb); // pad to byte boundary
      for (var pad = 0xec; bb.length < capacityBits; pad ^= 0xec ^ 0x11)
        appendBits(pad, 8, bb);

      var codewords = [];
      for (var i = 0; i < bb.length; i += 8) {
        var b = 0;
        for (var j = 0; j < 8; j++) b = (b << 1) | bb[i + j];
        codewords.push(b);
      }
      return new QrCode(version, ecl, codewords);
    }
    throw new Error("Data too long for a QR code");
  }

  // Draw onto a <canvas>. The quiet zone (border, in modules) is painted in,
  // so the canvas can be displayed edge-to-edge.
  function render(canvas, text, opts) {
    opts = opts || {};
    var ecl = opts.ecl != null ? opts.ecl : ECC.M;
    var border = opts.border != null ? opts.border : 2;
    var scale = opts.scale || 4;
    var dark = opts.dark || "#0c0b0a";
    var light = opts.light || "#ffffff";

    var qr = encode(text, ecl);
    var size = qr.size;
    var dim = (size + border * 2) * scale;
    canvas.width = dim;
    canvas.height = dim;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, dim, dim);
    ctx.fillStyle = dark;
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        if (qr.modules[y][x])
          ctx.fillRect((x + border) * scale, (y + border) * scale, scale, scale);
      }
    }
    return qr;
  }

  global.QRCode = { ECC: ECC, encode: encode, render: render };
})(window);
