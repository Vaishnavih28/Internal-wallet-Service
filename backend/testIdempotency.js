

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


async function testSequentialDuplicates() {

    console.log('TEST 1: Sequential Duplicate Requests');


    const userId = 3;
    const balanceBefore = await getBalance(userId);
    const idempotencyKey = `idem-test-sequential-${Date.now()}`;

    console.log(`Balance before: ${balanceBefore}`);
    console.log(`Sending same request 3 times with key: ${idempotencyKey}`);

    const results = [];
    for (let i = 0; i < 3; i++) {
        const result = await makeRequest(`${BASE_URL}/topup`, {
            userId,
            amount: 100,
            idempotencyKey,
        });
        results.push(result);
        console.log(`  Request ${i + 1}: ${result.message} | idempotent: ${result.idempotent || false}`);
    }

    const balanceAfter = await getBalance(userId);
    console.log(`Balance before:${balanceBefore}`);
    console.log(`Balance after:${balanceAfter}`);
    console.log(`Difference:${balanceAfter - balanceBefore}`);

    const firstSucceeded = results[0].message === 'Top-up successful';
    const secondIdempotent = results[1].idempotent === true;
    const thirdIdempotent = results[2].idempotent === true;
    const balanceCorrect = (balanceAfter - balanceBefore) === 100;

    if (firstSucceeded && secondIdempotent && thirdIdempotent && balanceCorrect) {
        console.log(`Processed only once`);
    } else {
        console.log(`FAILED`);
        console.log(`First succeeded:   ${firstSucceeded}`);
        console.log(`Second idempotent: ${secondIdempotent}`);
        console.log(`Third idempotent:  ${thirdIdempotent}`);
        console.log(`Balance correct:   ${balanceCorrect}`);
    }
}


async function testParallelDuplicates() {
   
    console.log('TEST 2: Parallel Duplicate Requests');
    

    const userId = 3; 
    const balanceBefore = await getBalance(userId);
    const idempotencyKey = `idem-test-parallel-${Date.now()}`;

    console.log(`Balance before: ${balanceBefore}`);
    console.log(`Firing 5 identical requests simultaneously...`);
    console.log(`Key: ${idempotencyKey}`);

    
    const requests = Array.from({ length: 5 }, () =>
        makeRequest(`${BASE_URL}/topup`, {
            userId,
            amount: 100,
            idempotencyKey, 
        })
    );

    const results = await Promise.all(requests);

    const succeeded = results.filter(r => r.message === 'Top-up successful');
    const idempotent = results.filter(r => r.idempotent === true);
    const errors = results.filter(r => r.error && !r.idempotent);

    console.log(`Results:`);
    console.log(`Processed (should be 1):${succeeded.length}`);
    console.log(`Idempotent (should be 4):${idempotent.length}`);
    console.log(`Errors (should be 0):${errors.length}`);

    const balanceAfter = await getBalance(userId);
    console.log(`Balance before: ${balanceBefore}`);
    console.log(`Balance after:  ${balanceAfter}`);
    console.log(`Difference:     ${balanceAfter - balanceBefore} (should be 100)`);

    const balanceCorrect = (balanceAfter - balanceBefore) === 100;
    const onlyOneSuccess = succeeded.length === 1;

    if (balanceCorrect && onlyOneSuccess && errors.length === 0) {
        console.log(`Race condition on idempotency handled correctly!`);
    } else {
        console.log(`FAILED`);
        console.log(`Balance correct: ${balanceCorrect}`);
        console.log(`Only one success: ${onlyOneSuccess}`);
        console.log(`No errors: ${errors.length === 0}`);
    }
}


async function testDifferentKeysProcessSeparately() {
    
    console.log('TEST 3: Different Keys = Separate Transactions');
   
    const userId = 3; // Sam
    const balanceBefore = await getBalance(userId);
    const timestamp = Date.now();

    console.log(`Balance before: ${balanceBefore}`);
    console.log(`Sending 3 requests with DIFFERENT keys...`);

    const results = await Promise.all([
        makeRequest(`${BASE_URL}/topup`, {
            userId, amount: 100,
            idempotencyKey: `unique-key-1-${timestamp}`,
        }),
        makeRequest(`${BASE_URL}/topup`, {
            userId, amount: 100,
            idempotencyKey: `unique-key-2-${timestamp}`,
        }),
        makeRequest(`${BASE_URL}/topup`, {
            userId, amount: 100,
            idempotencyKey: `unique-key-3-${timestamp}`,
        }),
    ]);

    const succeeded = results.filter(r => r.message === 'Top-up successful');

    const balanceAfter = await getBalance(userId);
    console.log(`\nBalance before: ${balanceBefore}`);
    console.log(`Balance after:  ${balanceAfter}`);
    console.log(`Difference:     ${balanceAfter - balanceBefore} (should be 300)`);

    if (succeeded.length === 3 && (balanceAfter - balanceBefore) === 300) {
        console.log(`Different keys processed as separate transactions!`);
    } else {
        console.log(`FAILED`);
    }
}


async function runAll() {
    console.log('Starting idempotency tests...');

    try {
        await testSequentialDuplicates();
        await testParallelDuplicates();
        await testDifferentKeysProcessSeparately();

        console.log('All idempotency tests complete!');

    } catch (err) {
        console.error('Test error:', err.message);
    }
}

runAll();