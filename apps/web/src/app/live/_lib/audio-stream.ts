type ChunkPayload = {
  audio: {
    mimeType: string;
    data: string;
  };
  level: number;
};

type ChunkHandler = (chunk: ChunkPayload) => void;
type DebugHandler = (message: string) => void;

export class PcmAudioStream {
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private mediaStream: MediaStream | null = null;
  private chunkHandler: ChunkHandler | null = null;
  private debugHandler: DebugHandler | null = null;
  private firstChunk = true;

  onChunk(handler: ChunkHandler): void {
    this.chunkHandler = handler;
  }

  onDebug(handler: DebugHandler): void {
    this.debugHandler = handler;
  }

  async start(): Promise<void> {
    if (typeof window === 'undefined' || !navigator.mediaDevices) {
      throw new Error('Audio capture is unavailable in this browser.');
    }

    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    this.debug(`getUserMedia ok`);

    this.audioContext = new AudioContext();
    this.debug(`audioContext state=${this.audioContext.state}`);
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume().catch(() => undefined);
      this.debug(`audioContext resume -> ${this.audioContext.state}`);
    }
    const source = this.audioContext.createMediaStreamSource(this.mediaStream);
    const processor = this.audioContext.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const pcm16 = downsampleTo16kPcm(input, this.audioContext?.sampleRate ?? 48000);
      if (!pcm16 || pcm16.length === 0) {
        return;
      }

      const level = estimateLevel(input);
      if (this.firstChunk) {
        this.firstChunk = false;
        this.debug(`first_chunk samples=${pcm16.length} level=${level.toFixed(4)}`);
      }
      const audio = int16ToPcmBase64(pcm16, 16000);
      this.chunkHandler?.({ audio, level });
    };

    source.connect(processor);
    processor.connect(this.audioContext.destination);

    this.sourceNode = source;
    this.processorNode = processor;
    this.debug('processor connected');
  }

  async stop(): Promise<void> {
    this.processorNode?.disconnect();
    this.sourceNode?.disconnect();
    this.mediaStream?.getTracks().forEach((track) => track.stop());
    this.mediaStream = null;
    this.sourceNode = null;
    this.processorNode = null;

    if (this.audioContext) {
      await this.audioContext.close().catch(() => undefined);
      this.audioContext = null;
    }
    this.firstChunk = true;
  }

  private debug(message: string): void {
    this.debugHandler?.(message);
  }
}

function downsampleTo16kPcm(input: Float32Array, sourceRate: number): Int16Array {
  const targetRate = 16000;
  if (sourceRate <= targetRate) {
    return floatToInt16(input);
  }

  const ratio = sourceRate / targetRate;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Int16Array(outputLength);

  for (let i = 0; i < outputLength; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    let count = 0;

    for (let j = start; j < end; j += 1) {
      sum += input[j];
      count += 1;
    }

    const sample = count > 0 ? sum / count : 0;
    const clamped = Math.max(-1, Math.min(1, sample));
    output[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }

  return output;
}

function floatToInt16(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, input[i]));
    output[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return output;
}

function int16ToPcmBase64(samples: Int16Array, sampleRate: number): { mimeType: string; data: string } {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < samples.length; i += 1) {
    view.setInt16(i * 2, samples[i], true);
  }
  return {
    mimeType: `audio/pcm;rate=${sampleRate}`,
    data: bytesToBase64(new Uint8Array(buffer)),
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function estimateLevel(input: Float32Array): number {
  if (input.length === 0) {
    return 0;
  }

  let sumSquares = 0;
  for (let i = 0; i < input.length; i += 1) {
    sumSquares += input[i] * input[i];
  }
  return Math.sqrt(sumSquares / input.length);
}
