'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var EventEmitter = require('events');
var child_process = require('child_process');

function _interopDefaultLegacy (e) { return e && typeof e === 'object' && 'default' in e ? e : { 'default': e }; }

var EventEmitter__default = /*#__PURE__*/_interopDefaultLegacy(EventEmitter);

/* 
 * There isn't an exact correspondence between states and events:
 * - idle doesn't have an event (present only in the constructor);
 * - there is no PROC_DEAD state (it complicates the state machine
 * far beyond its merits);
 *
 * Do not rely on the synchronicity of event reception and state
 * transitions: check the state when you want to interact with the 
 * ProcMaster. Timestamps are provided for convenience. Events
 * are now conceivably most useful for some monitoring/reporting tasks.
 */
const MASTER_STATE = {
    IDLE: 0,
    PROC_ALIVE: 1,
    PROC_DYING: 2,
    PROC_REAPED: 3
};

function sleep(deadline) {
    return new Promise((resolve, reject) => {
        // TODO: does this delay an eventual shutdown event?
        setTimeout(resolve, deadline);
    });
}

function reapProcess(master, deadProcess) {
    deadProcess.unref();

    /* 
     * Check to see if this is the current process: the handler
     * is competing from the process exit event and from the
     * kill method.
     */
    if (master.process === deadProcess) {
        const now = Date.now();

        master.process = null;
        master.procState = MASTER_STATE.PROC_REAPED;
        master.emit('proc-reaped', deadProcess, now);
    }
}

class ProcMaster extends EventEmitter__default['default'] {
    constructor(name, settings) {
        super();

        this.name = name;
        this.settings = settings;
        this.process = null;
        this.procState = MASTER_STATE.IDLE;
    }

    async afterReap() {
        if (this.process !== null) {
            const currentProcess = this.process;

            await new Promise((resolve, reject) => {
                this.once('proc-reaped', (deadProcess, ts) => {
                    /* 
                     * Strictly speaking, you don't seem to need this test,
                     * unless some new process is spawned and reaped through
                     * the same event emitter, preempting this handler.
                     * Seems impossible at this moment frankly, but keeping
                     * it for good measure.
                     */
                    if (currentProcess === deadProcess) {
                        resolve();
                    }
                });
            });
        }

        return this;
    }

    async animate() {
        switch (this.procState) {
            case MASTER_STATE.IDLE:
            case MASTER_STATE.PROC_REAPED: {
                const {cmd,args} = this.settings;
                // TODO: research spawn options
                const stdioOpts = ['ignore', 'ignore', 'ignore'];
                const currentProcess = child_process.spawn(cmd, args, {stdio: stdioOpts});
                const now = Date.now();

                currentProcess.once('exit', (code, sig) => {
                    const now = Date.now();

                    setTimeout(() => {
                        this.emit('proc-dead', currentProcess, code, sig, now);
                        reapProcess(this, currentProcess);
                    });
                });

                this.process = currentProcess;
                this.procState = MASTER_STATE.PROC_ALIVE;
                this.emit('proc-alive', this.process, cmd, args, now);

                return this;
            }
            case MASTER_STATE.PROC_ALIVE: { 
                return this; 
            }
            case MASTER_STATE.PROC_DYING: {
                throw new Error(`Process ${this.name} is being stopped`);
            }
            // should never happen
            default: {
                throw new Error(`Process ${this.name} in unknown state`);
            }
        }
    }

    async kill(sig, deadline) {
        switch (this.procState) {
            case MASTER_STATE.IDLE: {
                throw new Error(`Process ${this.name} not started yet`);
            }
            case MASTER_STATE.PROC_ALIVE: {
                const currentProcess = this.process;
                const processReaped = this.afterReap();
                const now = Date.now();

                this.procState = MASTER_STATE.PROC_DYING;
                this.emit('proc-dying', currentProcess, sig, deadline, now);

                if (currentProcess.kill(sig)) {
                    const reaped = await Promise.race([
                        processReaped.then(() => true), 
                        sleep(deadline).then(() => false)
                    ]);

                    if (reaped) return this;
                }

                console.warn(`Process ${this.name} unresponsive to ${sig}, sending SIGKILL`);

                if (!currentProcess.kill('SIGKILL')) {
                    console.warn(`Process ${this.name} could not be SIGKILLED`);
                    reapProcess(this, currentProcess);
                }

                return await processReaped;
            }
            case MASTER_STATE.PROC_DYING: {
                return await this.afterReap();
            }
            case MASTER_STATE.PROC_REAPED: {
                return this;
            }
            // should never happen
            default: {
                throw new Error(`Process ${this.name} in unknown state`);
            }
        }
    }
}

ProcMaster.States = MASTER_STATE;

// TODO: maybe ok to use a validator here to be fair
function validate(procCfg) {
    if (typeof(procCfg) !== 'object') {
        throw new Error('Invalid currentProcess config: top-level not object');
    }

    for (let [name, proc] of Object.entries(procCfg)) {
        const looksSane = typeof(proc) == 'object'
            && typeof(proc.cmd) == 'string'
            && proc.args instanceof Array;

        if (!looksSane) {
           throw new Error(`Invalid currentProcess config: entry for ${name} not sane`);
        }
    }
}

function setupMasterListeners(master) {
    const name = master.name;

    master.on("proc-alive", (proc, cmd, args, ts) => {
        console.info(`${ts}: ${name} started: ${cmd} ${args}`);
    });
    master.on("proc-dying", (proc, sig, deadline, ts) => {
        console.info(`${ts}: ${name} stopping: ${sig} ${deadline}`);
    });
    master.on("proc-dead", (proc, code, sig, ts) => {
        console.info(`${ts}: ${name} stopped: ${code} ${sig}`);
    });
    master.on("proc-reaped", (proc, ts) => {
        console.info(`${ts}: ${name} reaped`);
    });
}

class Overlord {
    constructor(procCfg) {
        validate(procCfg);
        
        const cfgList = Object.entries(procCfg);
        const masters = cfgList.map(([name, cfg]) => {
            const master = new ProcMaster(name, cfg);
            
            setupMasterListeners(master);

            return [name, master];
        });

        this.config = procCfg;
        this.procMap = new Map(masters);
    }

    async animateAll() {
        const startList = [...this.procMap.values()].map((master) => {
            return master.animate().catch((error) => {
                console.warn(
                    `Overlord: Failed attempt to start ${master.name}.`,
                    error
                );
            });
        });

        const results = await Promise.all(startList);
    }

    async killAll(sig = 'SIGTERM', deadline = 5000) {
        const stopList = [...this.procMap.values()].map((master) => {
            return master.kill(sig, deadline).catch((error) => {
                console.warn(
                    `Overlord: Failed attempt to stop ${master.name}.`, 
                    error
                );
            });
        });

        const results = await Promise.all(stopList);
    }
}

exports.Overlord = Overlord;
