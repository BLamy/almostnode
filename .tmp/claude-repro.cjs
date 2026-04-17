const { createContainer } = require('../packages/almostnode/dist/index.cjs');

async function main() {
  const container = createContainer({ cwd: '/project' });
  const chunks = [];
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, 20000);

  try {
    const result = await container.run('npx @anthropic-ai/claude-code', {
      signal: controller.signal,
      onStdout: (chunk) => {
        chunks.push(`STDOUT:${chunk}`);
      },
      onStderr: (chunk) => {
        chunks.push(`STDERR:${chunk}`);
      },
    });

    console.log(
      JSON.stringify(
        {
          exitCode: result.exitCode,
          stdout: result.stdout.slice(0, 4000),
          stderr: result.stderr.slice(0, 4000),
          chunks: chunks.slice(0, 200),
        },
        null,
        2,
      ),
    );
  } finally {
    clearTimeout(timer);
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
