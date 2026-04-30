export function parseArgs(argv) {
  const args = { headless: true, limit: 10, resetReviewHistory: false };

  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index];
    const next = argv[index + 1];

    if (part === '--mode') {
      args.mode = next;
    }

    if (part === '--campaign') {
      args.campaign = next;
    }

    if (part === '--limit') {
      args.limit = Number(next);
    }

    if (part === '--headed') {
      args.headless = false;
    }

    if (part === '--reset-review-history') {
      args.resetReviewHistory = true;
    }
  }

  if (!args.mode) {
    throw new Error('Missing required --mode');
  }

  if (!['review', 'send', 'daily-summary'].includes(args.mode)) {
    throw new Error('Mode must be review, send, or daily-summary');
  }

  if (args.mode !== 'daily-summary' && !args.campaign) {
    throw new Error('Missing required --campaign');
  }

  if (!Number.isInteger(args.limit) || args.limit < 1) {
    throw new Error('Limit must be a positive integer');
  }

  return args;
}
