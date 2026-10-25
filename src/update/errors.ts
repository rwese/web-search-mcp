import { SearchError } from "../core/errors.js";

/** A failure while checking, downloading, verifying, or installing an update. */
export class UpdateError extends SearchError {
  constructor(message: string) {
    super(message);
    this.name = "UpdateError";
  }
}

/** Another update process holds the install lock. */
export class UpdateBusy extends UpdateError {
  constructor(message = "another update is already in progress") {
    super(message);
    this.name = "UpdateBusy";
  }
}

/** The install is owned by a package manager or an immutable environment. */
export class UpdateUnsupported extends UpdateError {
  constructor(message: string) {
    super(message);
    this.name = "UpdateUnsupported";
  }
}
