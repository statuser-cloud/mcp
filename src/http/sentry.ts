import type * as SentryModule from '@sentry/node';

type Sentry = typeof SentryModule;

export interface ErrorReporter {
  capture(err: unknown, tags?: Record<string, string>): void;
}

const noop: ErrorReporter = { capture: () => undefined };

/**
 * Error reporting for the hosted endpoint only, and only when a DSN is set.
 *
 * `@sentry/node` is an optional peer dependency: `npx` users never download it,
 * and the stdio entrypoint never loads this file. The variable is
 * STATUSER_SENTRY_DSN rather than SENTRY_DSN so that a DSN someone keeps in
 * their own environment is never picked up.
 *
 * Events carry the stack and a tool name, nothing from the request: headers
 * hold the caller's API key and tool arguments can hold webhook secrets.
 */
export async function initErrorReporter(
  dsn: string | undefined,
  release: string,
  environment: string,
): Promise<ErrorReporter> {
  if (!dsn) return noop;

  let sentry: Sentry;
  try {
    sentry = await import('@sentry/node');
  } catch {
    process.stderr.write(
      '[@statuser/mcp] STATUSER_SENTRY_DSN is set but @sentry/node is not installed; error reporting is off\n',
    );
    return noop;
  }

  sentry.init({
    dsn,
    release,
    environment,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    // No default integrations: the HTTP ones would record outgoing request
    // URLs (search terms included) and incoming headers as breadcrumbs.
    defaultIntegrations: false,
    integrations: [
      sentry.onUncaughtExceptionIntegration(),
      sentry.onUnhandledRejectionIntegration(),
      sentry.linkedErrorsIntegration(),
    ],
    beforeSend(event) {
      delete event.request;
      delete event.user;
      delete event.breadcrumbs;
      return event;
    },
  });

  return {
    capture(err, tags) {
      sentry.captureException(err, { tags });
    },
  };
}
