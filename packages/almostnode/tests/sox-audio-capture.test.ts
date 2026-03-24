/**
 * Tests for the SoX/rec audio capture shim
 */

import { describe, it, expect } from 'vitest';
import {
  parseSoxArgs,
  float32ToInt16PCM,
  downsample,
  createSilenceDetector,
  isAudioCaptureCommand,
} from '../src/shims/sox-audio-capture';

describe('isAudioCaptureCommand', () => {
  it('detects rec command', () => {
    expect(isAudioCaptureCommand('rec', ['-q', '-t', 'raw'])).toBe(true);
  });

  it('detects rec with full path', () => {
    expect(isAudioCaptureCommand('/usr/bin/rec', ['-r', '16000'])).toBe(true);
    expect(isAudioCaptureCommand('/usr/local/bin/rec', [])).toBe(true);
  });

  it('detects sox -d command', () => {
    expect(isAudioCaptureCommand('sox', ['-d', '-t', 'raw', '-'])).toBe(true);
  });

  it('does not match sox without -d', () => {
    expect(isAudioCaptureCommand('sox', ['input.wav', 'output.wav'])).toBe(false);
  });

  it('does not match unrelated commands', () => {
    expect(isAudioCaptureCommand('node', ['server.js'])).toBe(false);
    expect(isAudioCaptureCommand('npm', ['install'])).toBe(false);
  });
});

describe('parseSoxArgs', () => {
  it('parses Claude Code exact command', () => {
    const config = parseSoxArgs('rec', [
      '-q', '-r', '16000', '-e', 'signed', '-b', '16', '-c', '1',
      '-t', 'raw', '-',
      'silence', '1', '0.1', '0.1%', '1', '1.0', '0.1%',
    ]);

    expect(config.sampleRate).toBe(16000);
    expect(config.encoding).toBe('signed');
    expect(config.bitDepth).toBe(16);
    expect(config.channels).toBe(1);
    expect(config.format).toBe('raw');
    expect(config.quiet).toBe(true);
    expect(config.silence).not.toBeNull();
    expect(config.silence!.belowPeriods).toBe(1);
    expect(config.silence!.belowDuration).toBe(0.1);
    expect(config.silence!.belowThreshold).toBe(0.001);
    expect(config.silence!.abovePeriods).toBe(1);
    expect(config.silence!.duration).toBe(1.0);
    expect(config.silence!.threshold).toBe(0.001);
  });

  it('parses sox -d form', () => {
    const config = parseSoxArgs('sox', [
      '-d', '-r', '44100', '-b', '16', '-c', '2', '-t', 'raw', '-',
    ]);

    expect(config.sampleRate).toBe(44100);
    expect(config.bitDepth).toBe(16);
    expect(config.channels).toBe(2);
    expect(config.format).toBe('raw');
  });

  it('uses defaults for missing args', () => {
    const config = parseSoxArgs('rec', []);

    expect(config.sampleRate).toBe(16000);
    expect(config.bitDepth).toBe(16);
    expect(config.channels).toBe(1);
    expect(config.encoding).toBe('signed');
    expect(config.format).toBe('raw');
    expect(config.quiet).toBe(false);
    expect(config.silence).toBeNull();
  });

  it('parses long-form args', () => {
    const config = parseSoxArgs('rec', [
      '--rate', '48000', '--bits', '32', '--channels', '2',
      '--encoding', 'float', '--type', 'wav', '--quiet',
    ]);

    expect(config.sampleRate).toBe(48000);
    expect(config.bitDepth).toBe(32);
    expect(config.channels).toBe(2);
    expect(config.encoding).toBe('float');
    expect(config.format).toBe('wav');
    expect(config.quiet).toBe(true);
  });

  it('parses silence with 3 args (single phase)', () => {
    const config = parseSoxArgs('rec', [
      '-t', 'raw', '-', 'silence', '1', '2.0', '3%',
    ]);

    expect(config.silence).not.toBeNull();
    expect(config.silence!.abovePeriods).toBe(1);
    expect(config.silence!.duration).toBe(2.0);
    expect(config.silence!.threshold).toBe(0.03);
    expect(config.silence!.belowPeriods).toBe(0);
  });

  it('parses dB thresholds', () => {
    const config = parseSoxArgs('rec', [
      '-t', 'raw', '-', 'silence', '1', '0.5', '-50d',
    ]);

    expect(config.silence).not.toBeNull();
    // -50dB ≈ 0.00316
    expect(config.silence!.threshold).toBeCloseTo(0.00316, 4);
  });

  it('parses signed-integer and unsigned-integer encoding names', () => {
    let config = parseSoxArgs('rec', ['-e', 'signed-integer']);
    expect(config.encoding).toBe('signed');

    config = parseSoxArgs('rec', ['-e', 'unsigned-integer']);
    expect(config.encoding).toBe('unsigned');

    config = parseSoxArgs('rec', ['-e', 'floating-point']);
    expect(config.encoding).toBe('float');
  });
});

describe('float32ToInt16PCM', () => {
  it('converts silence (zeros)', () => {
    const input = new Float32Array([0, 0, 0]);
    const output = float32ToInt16PCM(input);
    expect(output.length).toBe(6); // 3 samples * 2 bytes
    expect(output[0]).toBe(0);
    expect(output[1]).toBe(0);
  });

  it('converts max positive', () => {
    const input = new Float32Array([1.0]);
    const output = float32ToInt16PCM(input);
    // 0x7FFF = 32767, little-endian: 0xFF, 0x7F
    expect(output[0]).toBe(0xFF);
    expect(output[1]).toBe(0x7F);
  });

  it('converts max negative', () => {
    const input = new Float32Array([-1.0]);
    const output = float32ToInt16PCM(input);
    // -32768 = 0x8000, little-endian: 0x00, 0x80
    expect(output[0]).toBe(0x00);
    expect(output[1]).toBe(0x80);
  });

  it('clamps values outside [-1, 1]', () => {
    const input = new Float32Array([2.0, -2.0]);
    const output = float32ToInt16PCM(input);
    // Should be clamped to max/min int16
    expect(output[0]).toBe(0xFF);
    expect(output[1]).toBe(0x7F);
    expect(output[2]).toBe(0x00);
    expect(output[3]).toBe(0x80);
  });

  it('converts a mid-range value', () => {
    const input = new Float32Array([0.5]);
    const output = float32ToInt16PCM(input);
    // 0.5 * 0x7FFF = 16383.5, rounded = 16384 = 0x4000
    const value = output[0] | (output[1] << 8);
    expect(value).toBeCloseTo(16384, -1);
  });
});

describe('downsample', () => {
  it('returns same samples when rates match', () => {
    const input = new Float32Array([0.1, 0.2, 0.3]);
    const output = downsample(input, 16000, 16000);
    expect(output).toBe(input); // same reference
  });

  it('downsamples 48000 to 16000 (3:1)', () => {
    // 6 samples at 48kHz → 2 samples at 16kHz
    const input = new Float32Array([0.0, 0.3, 0.6, 0.9, 0.6, 0.3]);
    const output = downsample(input, 48000, 16000);
    expect(output.length).toBe(2);
  });

  it('downsamples 44100 to 16000', () => {
    const length = 441;
    const input = new Float32Array(length);
    for (let i = 0; i < length; i++) input[i] = Math.sin(i * 0.1);
    const output = downsample(input, 44100, 16000);
    // ratio = 44100/16000 = 2.75625, expected ~160 samples
    expect(output.length).toBe(Math.floor(length / (44100 / 16000)));
  });

  it('preserves DC signal', () => {
    const input = new Float32Array(300).fill(0.5);
    const output = downsample(input, 48000, 16000);
    for (let i = 0; i < output.length; i++) {
      expect(output[i]).toBeCloseTo(0.5, 5);
    }
  });
});

describe('createSilenceDetector', () => {
  it('passes through samples in above-only mode when above threshold', () => {
    const detector = createSilenceDetector({
      abovePeriods: 1,
      duration: 1.0,
      threshold: 0.001,
      belowPeriods: 0,
      belowDuration: 0,
      belowThreshold: 0,
    });

    const samples = new Float32Array(100).fill(0.5);
    const result = detector.process(samples, 16000);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(100);
    expect(detector.shouldStop()).toBe(false);
  });

  it('stops after sustained silence exceeds duration', () => {
    const detector = createSilenceDetector({
      abovePeriods: 1,
      duration: 0.1, // 100ms
      threshold: 0.01,
      belowPeriods: 0,
      belowDuration: 0,
      belowThreshold: 0,
    });

    const sampleRate = 16000;
    const silentChunk = new Float32Array(1600).fill(0); // 100ms of silence

    // First chunk — silence accumulates
    detector.process(silentChunk, sampleRate);
    // Second chunk — exceeds duration
    detector.process(silentChunk, sampleRate);

    expect(detector.shouldStop()).toBe(true);
  });

  it('resets silence counter when sound resumes', () => {
    const detector = createSilenceDetector({
      abovePeriods: 1,
      duration: 0.2,
      threshold: 0.01,
      belowPeriods: 0,
      belowDuration: 0,
      belowThreshold: 0,
    });

    const sampleRate = 16000;
    const silentChunk = new Float32Array(1600).fill(0); // 100ms
    const loudChunk = new Float32Array(1600).fill(0.5); // 100ms

    detector.process(silentChunk, sampleRate); // 100ms silence
    detector.process(loudChunk, sampleRate);   // sound resets counter
    detector.process(silentChunk, sampleRate); // 100ms silence again

    expect(detector.shouldStop()).toBe(false);
  });

  it('skips leading silence in below+above mode', () => {
    const detector = createSilenceDetector({
      abovePeriods: 1,
      duration: 1.0,
      threshold: 0.001,
      belowPeriods: 1,
      belowDuration: 0.1,
      belowThreshold: 0.01,
    });

    const silentChunk = new Float32Array(100).fill(0);
    const loudChunk = new Float32Array(100).fill(0.5);

    // Leading silence — should be skipped
    const r1 = detector.process(silentChunk, 16000);
    expect(r1).toBeNull();
    expect(detector.shouldStop()).toBe(false);

    // Sound detected — transitions to above phase, passes through
    const r2 = detector.process(loudChunk, 16000);
    expect(r2).not.toBeNull();
    expect(r2!.length).toBe(100);
  });

  it('returns null after stop', () => {
    const detector = createSilenceDetector({
      abovePeriods: 1,
      duration: 0.001, // very short
      threshold: 0.01,
      belowPeriods: 0,
      belowDuration: 0,
      belowThreshold: 0,
    });

    const silentChunk = new Float32Array(1600).fill(0);
    detector.process(silentChunk, 16000);
    detector.process(silentChunk, 16000);

    expect(detector.shouldStop()).toBe(true);
    const result = detector.process(new Float32Array(100).fill(0.5), 16000);
    expect(result).toBeNull();
  });
});

describe('Claude Code recording flow', () => {
  it('simulates full Claude Code voice mode: skip leading silence, emit speech, stop on trailing silence', () => {
    const config = parseSoxArgs('rec', [
      '-q', '-r', '16000', '-e', 'signed', '-b', '16', '-c', '1',
      '-t', 'raw', '-',
      'silence', '1', '0.1', '0.1%', '1', '1.0', '0.1%',
    ]);

    expect(config.silence).not.toBeNull();
    const detector = createSilenceDetector(config.silence!);

    const sampleRate = 16000;
    const emittedChunks: Float32Array[] = [];

    const silentChunk = new Float32Array(1600).fill(0);
    const speechChunk = new Float32Array(1600).fill(0.1);

    const r1 = detector.process(silentChunk, sampleRate);
    expect(r1).toBeNull();
    expect(detector.shouldStop()).toBe(false);

    const r2 = detector.process(speechChunk, sampleRate);
    expect(r2).not.toBeNull();
    emittedChunks.push(r2!);
    expect(detector.shouldStop()).toBe(false);

    for (let i = 0; i < 5; i++) {
      const r = detector.process(speechChunk, sampleRate);
      if (r) emittedChunks.push(r);
    }
    expect(emittedChunks.length).toBe(6);
    expect(detector.shouldStop()).toBe(false);

    for (let i = 0; i < 10; i++) {
      detector.process(silentChunk, sampleRate);
    }
    expect(detector.shouldStop()).toBe(true);

    const afterStop = detector.process(speechChunk, sampleRate);
    expect(afterStop).toBeNull();
  });

  it('uses correct threshold from Claude Code command (0.1% = 0.001 linear)', () => {
    const config = parseSoxArgs('rec', [
      '-q', '-r', '16000', '-e', 'signed', '-b', '16', '-c', '1',
      '-t', 'raw', '-',
      'silence', '1', '0.1', '0.1%', '1', '1.0', '0.1%',
    ]);

    const detector = createSilenceDetector(config.silence!);

    const belowThresholdChunk = new Float32Array(1600).fill(0.0005);
    const r1 = detector.process(belowThresholdChunk, 16000);
    expect(r1).toBeNull();

    const aboveThresholdChunk = new Float32Array(1600).fill(0.002);
    const r2 = detector.process(aboveThresholdChunk, 16000);
    expect(r2).not.toBeNull();
  });

  it('emits PCM bytes in correct format for Claude Code', () => {
    const speechSamples = new Float32Array(100);
    for (let i = 0; i < 100; i++) {
      speechSamples[i] = Math.sin(i * 0.1) * 0.5;
    }

    const pcmBytes = float32ToInt16PCM(speechSamples);

    expect(pcmBytes.length).toBe(200);
    expect(pcmBytes instanceof Uint8Array).toBe(true);

    let hasNonZero = false;
    for (let i = 0; i < pcmBytes.length; i++) {
      if (pcmBytes[i] !== 0) {
        hasNonZero = true;
        break;
      }
    }
    expect(hasNonZero).toBe(true);
  });

  it('handles rapid speech-silence transitions without false stops', () => {
    const config = parseSoxArgs('rec', [
      '-q', '-r', '16000', '-e', 'signed', '-b', '16', '-c', '1',
      '-t', 'raw', '-',
      'silence', '1', '0.1', '0.1%', '1', '1.0', '0.1%',
    ]);

    const detector = createSilenceDetector(config.silence!);
    const sampleRate = 16000;

    const speechChunk = new Float32Array(1600).fill(0.1);
    const briefSilence = new Float32Array(800).fill(0);

    detector.process(speechChunk, sampleRate);
    expect(detector.shouldStop()).toBe(false);

    for (let i = 0; i < 10; i++) {
      detector.process(briefSilence, sampleRate);
      detector.process(speechChunk, sampleRate);
    }

    expect(detector.shouldStop()).toBe(false);
  });
});
