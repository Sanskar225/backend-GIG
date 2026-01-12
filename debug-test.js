const request = require('supertest');

console.log('🔍 Debugging API...\n');

async function debugTest() {
    try {
        console.log('1. Testing POST request...');
        
        // Test 1: Simple POST to check body parsing
        const testRes = await request('http://localhost:5000')
            .post('/api/auth/register')
            .send({
                username: 'debuguser',
                email: 'debug@test.com',
                password: 'password123'
            })
            .set('Content-Type', 'application/json');
        
        console.log('Response status:', testRes.status);
        console.log('Response body:', JSON.stringify(testRes.body, null, 2));
        
        if (testRes.status === 201) {
            console.log('✅ Registration works!');
            
            // Test login
            console.log('\n2. Testing login...');
            const loginRes = await request('http://localhost:5000')
                .post('/api/auth/login')
                .send({
                    email: 'debug@test.com',
                    password: 'password123'
                });
            
            console.log('Login status:', loginRes.status);
            console.log('Login response:', loginRes.body);
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        
        // Test if server is responding at all
        console.log('\n🔧 Testing server response...');
        try {
            const health = await request('http://localhost:5000').get('/health');
            console.log('Health check:', health.status, health.body);
        } catch (e) {
            console.log('Cannot connect to server:', e.message);
        }
    }
}

debugTest();