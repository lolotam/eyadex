// The only file other modules may import (CLAUDE.architecture.md §2.1).
export {
  MailProviderChanges,
  type MailProviderActor,
  type MailProviderDeps,
} from "./use-cases/mail-provider-changes.ts";
export { getMailProvider } from "./queries/mail-provider.ts";
export { MAIL_PROVIDER_TEST_REQUESTED } from "./events/published.ts";
