import { FetchSource, type RangeResponse, type Source } from 'pmtiles';

/** Byte-identical PMTiles segments avoid single-file upload limits on static hosts. */
export class ChunkedSource implements Source {
  constructor(
    private readonly url: string,
    private readonly chunkBytes: number,
    private readonly size: number,
  ) {
    if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 1 || !Number.isSafeInteger(size) || size < 1) {
      throw new Error('Invalid terrain segment sizes');
    }
  }

  getKey(): string {
    return this.url;
  }

  async getBytes(offset: number, length: number, signal?: AbortSignal): Promise<RangeResponse> {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= this.size || length < 1) {
      throw new Error(`Invalid terrain range ${offset}+${length}`);
    }
    const end = Math.min(offset + length, this.size);
    const pieces: Promise<RangeResponse>[] = [];
    for (let start = offset; start < end; ) {
      const index = Math.floor(start / this.chunkBytes);
      const local = start % this.chunkBytes;
      const count = Math.min(end - start, this.chunkBytes - local);
      const source = new FetchSource(`${this.url}/${index.toString().padStart(4, '0')}.bin`);
      pieces.push(
        source.getBytes(local, count, signal).then((result) => {
          if (result.data.byteLength !== count) throw new Error(`Truncated terrain segment ${index}`);
          return result;
        }),
      );
      start += count;
    }
    const data = new Uint8Array(end - offset);
    let written = 0;
    for (const piece of await Promise.all(pieces)) {
      data.set(new Uint8Array(piece.data), written);
      written += piece.data.byteLength;
    }
    // Individual segment ETags differ; the immutable snapshot URL identifies the archive.
    return { data: data.buffer };
  }
}
