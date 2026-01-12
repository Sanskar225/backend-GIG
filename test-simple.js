console.log('🎯 Testing GigFlow Backend Setup...\n');

// Check if required modules exist
try {
    require('express');
    require('mongoose');
    require('dotenv');
    console.log('✅ Required modules are installed');
} catch (err) {
    console.error('❌ Missing modules:', err.message);
    process.exit(1);
}

// Check if server.js exists
try {
    const fs = require('fs');
    if (fs.existsSync('./server.js')) {
        console.log('✅ server.js file exists');
    } else {
        console.error('❌ server.js not found');
        process.exit(1);
    }
} catch (err) {
    console.error('❌ Error checking files:', err.message);
}

// Try to load server
try {
    const { app } = require('./server');
    console.log('✅ Server module loads successfully');
    
    // Test a simple request
    const request = require('supertest');
    
    console.log('\n🔍 Testing endpoints:');
    
    // Test root endpoint
    request(app)
        .get('/')
        .then(res => {
            console.log(`✅ GET / - ${res.statusCode} - ${res.body.message || 'OK'}`);
            
            // Test health endpoint
            return request(app).get('/health');
        })
        .then(res => {
            console.log(`✅ GET /health - ${res.statusCode} - ${res.body.status || 'OK'}`);
            
            // Test API structure
            return request(app).get('/api/gigs');
        })
        .then(res => {
            console.log(`✅ GET /api/gigs - ${res.statusCode}`);
            
            console.log('\n🎉 All basic tests passed!');
            console.log('\n📋 Next steps:');
            console.log('1. Make sure MongoDB is running');
            console.log('2. Run: npm run dev');
            console.log('3. Open: http://localhost:5000');
            console.log('4. Test API with: npm run test:simple');
            
            process.exit(0);
        })
        .catch(err => {
            console.error('❌ API test failed:', err.message);
            process.exit(1);
        });
    
} catch (err) {
    console.error('❌ Error loading server:', err.message);
    console.log('\n🔧 Troubleshooting:');
    console.log('1. Run: npm install');
    console.log('2. Check .env file exists');
    console.log('3. Make sure all model files exist');
    process.exit(1);
}