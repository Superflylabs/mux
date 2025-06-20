import path from "path";
import fs from 'fs';
import { Tail } from "tail";
import { MuxCommand, MuxProcessConfig, MuxLogger, MuxConfig } from "./config";
import { IPty, spawn } from 'node-pty';
import { treeKill } from "./helpers";

export class MuxProcess {
  public name: string;

  private children: IPty[] = [];
  private logPath?: string;
  private startPromise?: Promise<number>;

  constructor(
    private muxConfig: MuxConfig,
    private processConfig: MuxProcessConfig,
    private logger: MuxLogger,
  ) {
    this.name = processConfig.name;
  }

  public async stop(): Promise<void> {
    this.logger.info(`${this.name}: cleaning up`);

    if (this.processConfig.stop) {
      await this.runCommand(this.processConfig.stop);
    }

    this.logger.info(`${this.name}: shutting down`);

    for (const child of this.children) {
      if (child.pid) {
        // Normally, we could send a SIGTERM to the the top level process and
        // have it propagate down to all its children. HOWEVER, NPM will try to
        // keep their child processes alive at all possible costs which leaves
        // orphaned processes all over the place.
        //
        // So instead, use `treeKill` to send a SIGTERM to all child processes
        // at once to ensure a clean exit.
        const pids = await treeKill(child.pid, 'SIGTERM');
        this.logger.debug(`${this.name}: sent SIGTERM to ${pids.join(', ')}`);
      }
    }

    if (this.startPromise) {
      await this.startPromise;
    }
  }

  public async install(): Promise<number> {
    this.logger.debug(`${this.name}: truncating log file at ${this.getLogPath()}`);
    fs.truncateSync(this.getLogPath(), 0);

    if (!this.processConfig.install) {
      return Promise.resolve(0);
    }
    this.logger.info(`${this.name}: installing`);
    return await this.runCommand(this.processConfig.install);
  }

  public async start(): Promise<void> {
    this.logger.info(`${this.name}: starting`);
    this.startPromise = this.runCommand(this.processConfig.run);
    await this.startPromise;
  }

  public getLogPath(): string {
    if (!this.logPath) {
      const logDir = path.join(this.muxConfig.rootDir, this.muxConfig.logPath);
      fs.mkdirSync(logDir, { recursive: true });
      this.logPath = path.join(logDir, `${this.name.toLowerCase().replace(/ /g, '-')}.log`);
      fs.appendFileSync(this.logPath, ''); // "touch the file"
      fs.truncateSync(this.logPath, 0);
    }

    return this.logPath;
  }

  public getLogStream(lines = 100): Tail {
    return new Tail(this.getLogPath(), { nLines: lines, follow: true });
  }

  protected async runCommand(command: MuxCommand): Promise<number> {
    if (!command) {
      this.logger.warn('No command passed. Exiting with code 0');
      return Promise.resolve(0);
    }

    const {
      exec,
      dir = './',
      env = {}
    } = command;

    const cwd = path.join(this.muxConfig.rootDir, dir);

    const logFile = this.getLogPath();

    let resolver: (code: number) => void;
    const promise = new Promise<number>(resolve => {
      resolver = resolve
    });

    const bin = "sh";
    const args = ['-c', `cd ${cwd} && ${exec}`];

    this.logger.info(`${this.name}: Executing "${bin} ${args.join(' ')}"`);
    this.logger.debug(`${this.name}: Environtment variables: ${JSON.stringify(env)}`)

    const child = spawn(bin, args, {
      env: {
        ...process.env,
        ...env
      },
    });

    child.onData((data: string) => {
      fs.appendFileSync(logFile, data);
    });

    child.onExit(({ exitCode }) => {
      fs.appendFileSync(logFile, `exited with code ${exitCode}`);
      resolver(exitCode);
    });

    this.children.push(child);

    return promise;
  }
}
