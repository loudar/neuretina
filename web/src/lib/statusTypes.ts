// The status feed types are the hub's; re-exporting keeps client and server
// in lockstep.
export type {
  StatusEntry,
  StatusKind,
  StatusMessage,
  StatusState,
} from "../../../src/core/status/StatusHub.ts";
