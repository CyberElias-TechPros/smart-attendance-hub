// Expected business-rule failures (invalid input state, permission conflicts
// at the data layer, etc.). The HTTP layer maps these to 400 responses with a
// user-safe message; anything else is an unexpected error → 500 + logs.

export class BusinessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BusinessError";
  }
}
