/**
 * Synchronous guard around long-running update operations.
 *
 * React state disables the buttons and drives the UI, but state updates are not
 * synchronous: two callbacks can run before `busy` is rendered. This gate is
 * the boundary that guarantees only one DFU/resource operation starts.
 */
export class UpdateOperationGate {
  private active = false;

  tryAcquire(): boolean {
    if (this.active) {
      return false;
    }
    this.active = true;
    return true;
  }

  release(): void {
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }
}
