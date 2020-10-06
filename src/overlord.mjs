import {ProcMaster} from './proc-master.mjs';

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

async function killMe(sendsig, deadline) {
    console.info(`Initiating shutdown phase. Attempting clean stop`);

    for (let [name, child] of this.procMap) {
        if (!child.kill(sendsig)) {
        };

    }

    killMeNow.call(this)
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

export {Overlord};
