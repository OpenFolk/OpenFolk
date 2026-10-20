// Tests for which machine is responsible for a bot:  node local/src/responsible.test.ts
import { responsibleMachine } from './agent.ts';

let failures = 0;
const check = (name: string, actual: unknown, expected: unknown) => {
    const ok = actual === expected;
    console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok ? '' : ` (is ${String(actual)}, expected ${String(expected)})`}`);
    if (!ok) failures++;
};

check('lives on workstation, both awake', responsibleMachine({ machine: 'workstation' }, ['office', 'workstation']), 'workstation');
check('lives on workstation, only office awake: sleeps, does not move', responsibleMachine({ machine: 'workstation' }, ['office']), null);
check('nobody awake', responsibleMachine({ machine: 'workstation' }, []), null);
check('not placed yet (before 0.2): alphabetically first awake', responsibleMachine({ machine: '' }, ['workstation', 'office']), 'office');
check('not placed yet, nobody awake', responsibleMachine({ machine: '' }, []), null);

if (failures) process.exit(1);
console.log('all tests passed');
