import psTree from "ps-tree"

/**
 * Sends the specified signal to the provided pid and all of its descendents.
 *
 * Custom implementation of 'tree-kill'. It had some issues with detecting and
 * stopping grandchildren. It uses `pgrep -P PID` under the hood which does not
 * return the full tree of pids.
 */
export const treeKill = (pid: number, signal: string = 'SIGTERM'): Promise<number[]> => {
  return new Promise((resolve, reject) => {
    psTree(pid, (err, children) => {
      if (err) {
        reject(err);
      } else {
        const childPids = children.map(child => Number(child.PID))
        childPids.forEach(childPid => process.kill(childPid, signal))
        resolve(childPids);
      }
    });
  })
}
