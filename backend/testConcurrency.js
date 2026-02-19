

const BASE_URL = 'http://localhost:3000/api/wallet';

async function makeRequest(url, body) {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return response.json();
}

async function getBalance(userId) {
    const response = await fetch(`${BASE_URL}/balance/${userId}`);
    const data = await response.json();
    return data.balance;
}


async function testConcurrentSpends() {

    console.log('TEST 1: Concurrent Spends');


    const userId = 2;
    const balanceBefore = await getBalance(userId);
    console.log(`Balance before: ${balanceBefore}`);


    const requests = Array.from({ length: 10 }, (_, i) =>
        makeRequest(`${BASE_URL}/spend`, {
            userId,
            amount: 100,
            idempotencyKey: `concurrent-spend-test-${i}-${Date.now()}`,
            description: `Concurrent spend attempt ${i}`,
        })
    );


    const results = await Promise.all(requests);

    const succeeded = results.filter(r => r.message === 'Spend successful');
    const failed = results.filter(r => r.error === 'Insufficient balance');
    const otherErrors = results.filter(r => r.error && r.error !== 'Insufficient balance');

    console.log(`Results:`);
    console.log(`Succeeded:${succeeded.length}`);
    console.log(`Insufficient bal:${failed.length}`);
    console.log(`Other errors:${otherErrors.length}`);

    if (otherErrors.length > 0) {
        console.log('Other errors:', otherErrors);
    }

    const balanceAfter = await getBalance(userId);
    console.log(`Balance before:${balanceBefore}`);
    console.log(`Balance after:${balanceAfter}`);
    console.log(`Coins spent:${balanceBefore - balanceAfter}`);


    const expectedSpent = succeeded.length * 100;
    const actualSpent = balanceBefore - balanceAfter;

    if (actualSpent === expectedSpent) {
        console.log(`Balance is consistent! No race condition.`);
    } else {
        console.log(`Balance mismatch!`);
        console.log(`Expected spent:${expectedSpent}`);
        console.log(`Actual spent:${actualSpent}`);
    }
}


async function testConcurrentTopups() {

    console.log('TEST 2: Concurrent Top-ups');


    const userId = 3;
    const balanceBefore = await getBalance(userId);
    console.log(`Balance before: ${balanceBefore}`);

    const requests = Array.from({ length: 5 }, (_, i) =>
        makeRequest(`${BASE_URL}/topup`, {
            userId,
            amount: 100,
            idempotencyKey: `concurrent-topup-test-${i}-${Date.now()}`,
        })
    );

    const results = await Promise.all(requests);

    const succeeded = results.filter(r => r.message === 'Top-up successful');
    const failed = results.filter(r => r.error);

    console.log(`Results:`);
    console.log(`Succeeded:${succeeded.length}`);
    console.log(`Failed:${failed.length}`);

    const balanceAfter = await getBalance(userId);
    const expectedAfter = balanceBefore + (succeeded.length * 100);

    console.log(`Balance before:${balanceBefore}`);
    console.log(`Balance after:${balanceAfter}`);
    console.log(`Expected after:${expectedAfter}`);

    if (balanceAfter === expectedAfter) {
        console.log(`All top-ups recorded correctly!`);
    } else {
        console.log(`FAILED!`);
    }
}


async function testConcurrentSpendsOnZeroBalance() {

    console.log('TEST 3: Concurrent Spends on Zero Balance');


    const userId = 2;
    const balanceBefore = await getBalance(userId);
    console.log(`Balance before: ${balanceBefore}`);

    if (balanceBefore > 0) {
        console.log(`Skipping — Alice still has balance. Run after TEST 1.`);
        return;
    }

    const requests = Array.from({ length: 5 }, (_, i) =>
        makeRequest(`${BASE_URL}/spend`, {
            userId,
            amount: 100,
            idempotencyKey: `zero-balance-spend-${i}-${Date.now()}`,
        })
    );

    const results = await Promise.all(requests);
    const succeeded = results.filter(r => r.message === 'Spend successful');
    const failed = results.filter(r => r.error === 'Insufficient balance');

    console.log(`Results:`);
    console.log(`Succeeded (should be 0): ${succeeded.length}`);
    console.log(`Rejected  (should be 5): ${failed.length}`);

    const balanceAfter = await getBalance(userId);

    if (succeeded.length === 0 && balanceAfter === 0) {
        console.log(`Zero balance correctly protected!`);
    } else {
        console.log(`FAILED`);
        console.log(`Balance after: ${balanceAfter}`);
    }
}


async function runAll() {
    console.log('Starting concurrency tests...');


    try {
        await testConcurrentTopups();
        await testConcurrentSpends();
        await testConcurrentSpendsOnZeroBalance();
        console.log('All concurrency tests complete!');

    } catch (err) {
        console.error('Test error:', err.message);
    }
}

runAll();