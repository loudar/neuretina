/**
 * Converts arbitrary audio to Ogg/Opus so Matrix clients render it as a native
 * voice bubble. Uses the system ffmpeg when available; returns undefined when
 * ffmpeg is missing or the conversion fails, so callers can fall back to the
 * original audio instead of losing it.
 */
export async function convertToOggOpus(
  input: Uint8Array,
  options: { timeoutMs?: number } = {},
): Promise<Uint8Array<ArrayBuffer> | undefined> {
  const ffmpeg = Bun.which("ffmpeg");
  if (!ffmpeg) return undefined;

  const timeoutMs = options.timeoutMs ?? 30_000;
  let process: Bun.Subprocess<"pipe", "pipe", "pipe">;
  try {
    process = Bun.spawn({
      cmd: [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        "pipe:0",
        "-c:a",
        "libopus",
        "-b:a",
        "48k",
        "-f",
        "ogg",
        "pipe:1",
      ],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch {
    return undefined;
  }

  const timer = setTimeout(() => process.kill(), timeoutMs);
  try {
    process.stdin.write(input);
    await process.stdin.end();

    const [output, code] = await Promise.all([
      new Response(process.stdout).arrayBuffer(),
      process.exited,
    ]);
    if (code !== 0 || output.byteLength === 0) return undefined;
    return new Uint8Array(output);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
