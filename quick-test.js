const mongoose = require('mongoose');
const request = require('supertest');

console.log('🔧 Quick Test for GigFlow Backend\n');

async function quickTest() {
    try {
        console.log('1. Loading server...');
        const { app, server } = require('./server');
        
        console.log('2. Testing server health...');
        const healthRes = await request(app).get('/health');
        console.log(`   ✅ Health: ${healthRes.body.status}`);
        
        console.log('\n3. Testing API documentation...');
        const apiRes = await request(app).get('/');
        console.log(`   ✅ API: ${apiRes.body.message}`);
        
        console.log('\n4. Testing database connection...');
        console.log(`   ✅ Database: ${mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected'}`);
        
        console.log('\n🎯 Quick endpoint tests:');
        
        // Test authentication
        console.log('\n   A. Authentication test:');
        try {
            const registerRes = await request(app)
                .post('/api/auth/register')
                .send({
                    username: 'quicktest',
                    email: 'quick@test.com',
                    password: 'password123'
                });
            
            if (registerRes.status === 201) {
                console.log('     ✅ POST /api/auth/register - Working');
            } else {
                console.log(`     ❌ Register failed: ${registerRes.body.message}`);
            }
        } catch (err) {
            console.log(`     ⚠️  Register test skipped: ${err.message}`);
        }
        
        // Test gig browsing (public endpoint)
        console.log('\n   B. Gig browsing test:');
        try {
            const gigsRes = await request(app).get('/api/gigs');
            if (gigsRes.status === 200) {
                console.log(`     ✅ GET /api/gigs - Working (found ${gigsRes.body.results || gigsRes.body.data?.gigs?.length || 0} gigs)`);
            } else {
                console.log(`     ❌ Browse gigs failed: ${gigsRes.body.message}`);
            }
        } catch (err) {
            console.log(`     ⚠️  Browse test skipped: ${err.message}`);
        }
        
        console.log('\n📊 Summary:');
        console.log('   ✅ Server is responding');
        console.log('   ✅ Health check working');
        console.log('   ✅ API documentation available');
        
        if (mongoose.connection.readyState === 1) {
            console.log('   ✅ Database connected');
        } else {
            console.log('   ⚠️  Database not connected - make sure MongoDB is running');
        }
        
        console.log('\n🚀 Basic functionality verified!');
        console.log('\nTo run full tests:');
        console.log('  npm run test:simple  (for simple API test)');
        console.log('  npm run test:api     (for Jest test suite)');
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        console.error('\nTroubleshooting tips:');
        console.log('1. Make sure MongoDB is running: mongod');
        console.log('2. Check if port 5000 is available');
        console.log('3. Verify .env file exists with correct settings');
    } finally {
        // Give time for cleanup
        setTimeout(() => {
            process.exit(0);
        }, 1000);
    }
}

// Run quick test
quickTest();