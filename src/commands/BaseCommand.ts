/**
 * Base interface for all commands
 */
export interface ICommand {
  readonly id: string;
  execute(): Promise<void> | void;
}

