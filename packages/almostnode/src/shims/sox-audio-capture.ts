/**
 * SoX/rec audio capture shim — intercepts `rec` and `sox -d` commands
 * and uses browser getUserMedia + Web Audio API to capture mic audio,
 * streaming raw PCM to the child process's stdout.
 */

const DEBUG_SOX = true;
const BYPASS_SILENCE_DETECTION = true; // TESTING: bypass silence detection to see if audio flows

function debugLog(message: string, data?: unknown) {
  if (!DEBUG_SOX) return;
  if (data !== undefined) {
    console.log(`[sox-shim] ${message}`, data);
  } else {
    console.log(`[sox-shim] ${message}`);
  }
}

function computeRms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / (samples.length || 1));
}

function computePeak(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]);
    if (abs > peak) peak = abs;
  }
  return peak;
}

export interface SoxConfig {
  sampleRate: number;
  bitDepth: number;
  channels: number;
  encoding: 'signed' | 'unsigned' | 'float';
  format: string; // 'raw', 'wav', etc.
  silence: SilenceConfig | null;
  quiet: boolean;
}

export interface SilenceConfig {
  /** Number of silence periods before stopping (typically 1) */
  abovePeriods: number;
  /** Duration of silence to trigger stop (seconds) */
  duration: number;
  /** Threshold as percentage or dB (e.g. '0.1%', '-50d') */
  threshold: number;
  /** Optional leading silence skip */
  belowPeriods: number;
  belowDuration: number;
  belowThreshold: number;
}

export interface AudioCaptureHandle {
  cleanup: () => void;
}

const DEFAULT_CONFIG: SoxConfig = {
  sampleRate: 16000,
  bitDepth: 16,
  channels: 1,
  encoding: 'signed',
  format: 'raw',
  silence: null,
  quiet: false,
};

/**
 * Parse SoX CLI arguments into a typed config.
 * Handles both `rec` and `sox -d` invocations.
 *
 * Example: rec -q -r 16000 -e signed -b 16 -c 1 -t raw - silence 1 0.1 0.1% 1 1.0 0.1%
 */
export function parseSoxArgs(command: string, args: string[]): SoxConfig {
  const config: SoxConfig = { ...DEFAULT_CONFIG };

  // For `sox`, skip the `-d` input device arg
  const normalizedArgs = [...args];
  if (command === 'sox' || command.endsWith('/sox')) {
    const dIdx = normalizedArgs.indexOf('-d');
    if (dIdx !== -1) normalizedArgs.splice(dIdx, 1);
  }

  let i = 0;
  while (i < normalizedArgs.length) {
    const arg = normalizedArgs[i];

    switch (arg) {
      case '-r':
      case '--rate':
        config.sampleRate = parseInt(normalizedArgs[++i], 10) || DEFAULT_CONFIG.sampleRate;
        break;
      case '-b':
      case '--bits':
        config.bitDepth = parseInt(normalizedArgs[++i], 10) || DEFAULT_CONFIG.bitDepth;
        break;
      case '-c':
      case '--channels':
        config.channels = parseInt(normalizedArgs[++i], 10) || DEFAULT_CONFIG.channels;
        break;
      case '-e':
      case '--encoding': {
        const enc = normalizedArgs[++i];
        if (enc === 'signed' || enc === 'signed-integer') config.encoding = 'signed';
        else if (enc === 'unsigned' || enc === 'unsigned-integer') config.encoding = 'unsigned';
        else if (enc === 'float' || enc === 'floating-point') config.encoding = 'float';
        break;
      }
      case '-t':
      case '--type':
        config.format = normalizedArgs[++i] || DEFAULT_CONFIG.format;
        break;
      case '-q':
      case '--quiet':
        config.quiet = true;
        break;
      case 'silence':
        config.silence = parseSilenceArgs(normalizedArgs, i + 1);
        // Skip past all silence args
        i = normalizedArgs.length;
        continue;
      case '-':
        // stdout output, already the default behavior
        break;
      default:
        break;
    }
    i++;
  }

  return config;
}

function parseSilenceArgs(args: string[], startIdx: number): SilenceConfig {
  // silence [belowPeriods belowDuration belowThreshold] abovePeriods aboveDuration aboveThreshold
  const remaining = args.slice(startIdx);
  const silenceConfig: SilenceConfig = {
    abovePeriods: 1,
    duration: 1.0,
    threshold: 0.001,
    belowPeriods: 0,
    belowDuration: 0,
    belowThreshold: 0,
  };

  if (remaining.length >= 6) {
    // Two-phase: below (leading silence) + above (trailing silence)
    silenceConfig.belowPeriods = parseInt(remaining[0], 10) || 0;
    silenceConfig.belowDuration = parseFloat(remaining[1]) || 0;
    silenceConfig.belowThreshold = parseThreshold(remaining[2]);
    silenceConfig.abovePeriods = parseInt(remaining[3], 10) || 1;
    silenceConfig.duration = parseFloat(remaining[4]) || 1.0;
    silenceConfig.threshold = parseThreshold(remaining[5]);
  } else if (remaining.length >= 3) {
    // Single phase: above only
    silenceConfig.abovePeriods = parseInt(remaining[0], 10) || 1;
    silenceConfig.duration = parseFloat(remaining[1]) || 1.0;
    silenceConfig.threshold = parseThreshold(remaining[2]);
  }

  return silenceConfig;
}

function parseThreshold(value: string): number {
  if (value.endsWith('%')) {
    return parseFloat(value) / 100;
  }
  if (value.endsWith('d')) {
    // dB threshold — convert to linear amplitude
    const db = parseFloat(value);
    return Math.pow(10, db / 20);
  }
  return parseFloat(value) || 0.001;
}

/** Convert float32 samples [-1, 1] to little-endian signed int16 PCM bytes */
export function float32ToInt16PCM(samples: Float32Array): Uint8Array {
  const buffer = new Uint8Array(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    s = s < 0 ? s * 0x8000 : s * 0x7FFF;
    const int16 = Math.round(s);
    buffer[i * 2] = int16 & 0xFF;
    buffer[i * 2 + 1] = (int16 >> 8) & 0xFF;
  }
  return buffer;
}

/** Downsample via linear interpolation */
export function downsample(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return samples;

  const ratio = fromRate / toRate;
  const outputLength = Math.floor(samples.length / ratio);
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const srcIndex = i * ratio;
    const srcIndexFloor = Math.floor(srcIndex);
    const frac = srcIndex - srcIndexFloor;

    if (srcIndexFloor + 1 < samples.length) {
      output[i] = samples[srcIndexFloor] * (1 - frac) + samples[srcIndexFloor + 1] * frac;
    } else {
      output[i] = samples[srcIndexFloor] || 0;
    }
  }

  return output;
}

export interface SilenceDetector {
  /** Process samples, returns the samples that should be emitted (may be empty) */
  process(samples: Float32Array, sampleRate: number): Float32Array | null;
  /** Whether trailing silence has been detected and recording should stop */
  shouldStop(): boolean;
}

/**
 * Two-phase silence detector matching SoX semantics:
 * Phase 1 (below): skip leading silence until sound is detected
 * Phase 2 (above): stop when trailing silence duration exceeds threshold
 */
export function createSilenceDetector(config: SilenceConfig): SilenceDetector {
  let phase: 'below' | 'above' = config.belowPeriods > 0 ? 'below' : 'above';
  let silentSamples = 0;
  let stopped = false;

  function rms(samples: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i];
    }
    return Math.sqrt(sum / (samples.length || 1));
  }

  return {
    process(samples: Float32Array, sampleRate: number): Float32Array | null {
      if (stopped) return null;

      const level = rms(samples);

      if (phase === 'below') {
        const threshold = config.belowThreshold;
        if (level > threshold) {
          // Sound detected — move to above phase
          phase = 'above';
          silentSamples = 0;
          return samples;
        }
        // Still silent — skip
        return null;
      }

      // Phase: above — detect trailing silence
      const threshold = config.threshold;
      if (level <= threshold) {
        silentSamples += samples.length;
        const silentDuration = silentSamples / sampleRate;
        if (silentDuration >= config.duration) {
          stopped = true;
          return null;
        }
      } else {
        silentSamples = 0;
      }

      return samples;
    },

    shouldStop(): boolean {
      return stopped;
    },
  };
}

/** Check if a command is a rec or sox audio capture command */
export function isAudioCaptureCommand(command: string, args: string[]): boolean {
  const basename = command.slice(command.lastIndexOf('/') + 1);
  if (basename === 'rec') return true;
  if (basename === 'sox' && args.includes('-d')) return true;
  return false;
}

/**
 * Start audio capture using browser APIs.
 * Streams raw PCM data via onData callback.
 */
export async function startAudioCapture(
  config: SoxConfig,
  onData: (pcmBytes: Uint8Array) => void,
  onEnd: () => void,
  onError: (error: Error) => void,
): Promise<AudioCaptureHandle> {
  debugLog('startAudioCapture called with config:', {
    sampleRate: config.sampleRate,
    bitDepth: config.bitDepth,
    channels: config.channels,
    encoding: config.encoding,
    format: config.format,
    silence: config.silence,
    quiet: config.quiet,
  });

  let stream: MediaStream;
  try {
    debugLog('Requesting getUserMedia...');
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    debugLog('getUserMedia succeeded, got stream with tracks:', stream.getTracks().length);
  } catch (err) {
    debugLog('getUserMedia FAILED:', err);
    onError(new Error(`Microphone access denied: ${err}`));
    return { cleanup: () => {} };
  }

  const audioContext = new AudioContext();
  debugLog('AudioContext created, initial state:', audioContext.state);
  if (audioContext.state === 'suspended') {
    debugLog('AudioContext suspended, resuming...');
    await audioContext.resume();
    debugLog('AudioContext resumed, new state:', audioContext.state);
  }
  const source = audioContext.createMediaStreamSource(stream);
  const nativeRate = audioContext.sampleRate;
  debugLog('Native sample rate:', nativeRate);

  const bufferSize = 4096;
  const processor = audioContext.createScriptProcessor(bufferSize, config.channels, config.channels);

  let cleaned = false;
  let chunkCount = 0;
  let totalSamples = 0;
  let maxRms = 0;

  const silenceDetector = (config.silence && !BYPASS_SILENCE_DETECTION) ? createSilenceDetector(config.silence) : null;
  if (BYPASS_SILENCE_DETECTION && config.silence) {
    debugLog('*** BYPASS_SILENCE_DETECTION is ON — ignoring silence config, emitting all audio');
  } else if (silenceDetector) {
    debugLog('Silence detector created with config:', config.silence);
  } else {
    debugLog('No silence config — recording will continue until killed');
  }

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    debugLog('cleanup() called — FINAL STATE:', { 
      chunkCount, 
      totalSamples, 
      maxRms: maxRms.toFixed(6),
      emittedChunks,
      skippedChunks,
      silencePhase,
      threshold: config.silence?.belowThreshold?.toFixed(6) || 'none',
    });
    try {
      processor.disconnect();
      source.disconnect();
      audioContext.close();
      stream.getTracks().forEach(t => t.stop());
    } catch {
      // ignore cleanup errors
    }
  };

  let emittedChunks = 0;
  let skippedChunks = 0;
  let silencePhase: 'below' | 'above' | 'none' = silenceDetector ? 'below' : 'none';

  processor.onaudioprocess = (event: AudioProcessingEvent) => {
    if (cleaned) return;

    const samples = new Float32Array(event.inputBuffer.getChannelData(0));
    const rms = computeRms(samples);
    const peak = computePeak(samples);
    chunkCount++;
    totalSamples += samples.length;
    if (rms > maxRms) maxRms = rms;

    if (chunkCount <= 5 || chunkCount % 20 === 1) {
      debugLog(`Chunk #${chunkCount}: rms=${rms.toFixed(6)}, peak=${peak.toFixed(6)}, phase=${silencePhase}, emitted=${emittedChunks}, skipped=${skippedChunks}`);
    }

    const processed = nativeRate !== config.sampleRate
      ? downsample(samples, nativeRate, config.sampleRate)
      : samples;

    if (silenceDetector) {
      const processedRms = computeRms(processed);
      const threshold = silencePhase === 'below' 
        ? config.silence!.belowThreshold 
        : config.silence!.threshold;
      
      const filtered = silenceDetector.process(processed, config.sampleRate);
      
      if (filtered !== null && silencePhase === 'below') {
        silencePhase = 'above';
        debugLog(`*** PHASE TRANSITION: below -> above (rms=${processedRms.toFixed(6)} > threshold=${threshold.toFixed(6)})`);
      }
      
      if (silenceDetector.shouldStop()) {
        debugLog('Silence detector triggered stop — calling onEnd()', { emittedChunks, skippedChunks, totalSamples });
        cleanup();
        onEnd();
        return;
      }
      if (filtered === null) {
        skippedChunks++;
        if (skippedChunks <= 10 || skippedChunks % 50 === 0) {
          debugLog(`Skipped chunk (silence): rms=${processedRms.toFixed(6)}, threshold=${threshold.toFixed(6)}, phase=${silencePhase}`);
        }
        return;
      }
      emittedChunks++;
      const pcmBytes = float32ToInt16PCM(filtered);
      onData(pcmBytes);
    } else {
      emittedChunks++;
      const pcmBytes = float32ToInt16PCM(processed);
      
      // Log first few chunks with detailed format info
      if (emittedChunks <= 3) {
        const processedRms = computeRms(processed);
        debugLog(`Emitting chunk #${emittedChunks}:`, {
          inputSamples: samples.length,
          outputSamples: processed.length,
          pcmBytes: pcmBytes.length,
          rms: processedRms.toFixed(6),
          peak: computePeak(processed).toFixed(6),
          firstPcmBytes: Array.from(pcmBytes.slice(0, 10)).map(b => b.toString(16).padStart(2, '0')).join(' '),
          expectedRate: config.sampleRate,
          nativeRate,
        });
      }
      
      onData(pcmBytes);
    }
  };

  source.connect(processor);
  processor.connect(audioContext.destination);
  debugLog('Audio pipeline connected, capture active');

  return { cleanup };
}
