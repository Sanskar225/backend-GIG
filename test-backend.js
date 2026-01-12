const request = require('supertest');
const { app, server } = require('./server');
const mongoose = require('mongoose');
const { describe, test, expect, beforeAll, afterAll } = require('@jest/globals');

let authToken = '';
let freelancerToken = '';
let testGigId = '';
let testBidId = '';
let testUserId = '';

describe('🎯 GigFlow Backend API Tests', () => {
    beforeAll(async () => {
        // Wait for server to be ready
        await new Promise(resolve => setTimeout(resolve, 1000));
    });

    afterAll(async () => {
        await server.close();
        await mongoose.connection.close();
    });

    describe('✅ A. User Authentication', () => {
        test('1. Register client user', async () => {
            const response = await request(app)
                .post('/api/auth/register')
                .send({
                    username: 'testclient',
                    email: 'client@example.com',
                    password: 'Test@123',
                                        confirmPassword: 'Test@123',

                    role: 'client'
                });
            
            expect(response.status).toBe(201);
            expect(response.body.status).toBe('success');
            expect(response.body.data.user).toHaveProperty('username', 'testclient');
            expect(response.body.data.user).toHaveProperty('role', 'client');
            expect(response.body).toHaveProperty('token');
            
            authToken = response.body.token;
            testUserId = response.body.data.user._id;
        });

        test('2. Register freelancer user', async () => {
            const response = await request(app)
                .post('/api/auth/register')
                .send({
                    username: 'testfreelancer',
                    email: 'freelancer@example.com',
                    password: 'Test@123',
                    role: 'freelancer'
                });
            
            expect(response.status).toBe(201);
            expect(response.body.status).toBe('success');
            expect(response.body.data.user).toHaveProperty('username', 'testfreelancer');
            expect(response.body.data.user).toHaveProperty('role', 'freelancer');
            
            freelancerToken = response.body.token;
        });

        test('3. Login client user', async () => {
            const response = await request(app)
                .post('/api/auth/login')
                .send({
                    email: 'client@example.com',
                    password: 'Test@123'
                });
            
            expect(response.status).toBe(200);
            expect(response.body.status).toBe('success');
            expect(response.body).toHaveProperty('token');
            
            authToken = response.body.token;
        });

        test('4. Get current user', async () => {
            const response = await request(app)
                .get('/api/auth/me')
                .set('Authorization', `Bearer ${authToken}`);
            
            expect(response.status).toBe(200);
            expect(response.body.data.user).toHaveProperty('email', 'client@example.com');
        });
    });

    describe('✅ B. Gig Management (CRUD)', () => {
        test('1. Create new gig', async () => {
            const response = await request(app)
                .post('/api/gigs')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    title: 'Build a React E-commerce Website',
                    description: 'Need a modern e-commerce website built with React and Node.js. Must be responsive, SEO-friendly, and include payment integration.',
                    category: 'web-development',
                    budget: 2500,
                    deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                    skillsRequired: ['React', 'Node.js', 'MongoDB', 'Stripe']
                });
            
            expect(response.status).toBe(201);
            expect(response.body.status).toBe('success');
            expect(response.body.data.gig).toHaveProperty('title', 'Build a React E-commerce Website');
            expect(response.body.data.gig).toHaveProperty('status', 'open');
            expect(response.body.data.gig).toHaveProperty('budget', 2500);
            
            testGigId = response.body.data.gig._id;
        });

        test('2. Browse all open gigs (public)', async () => {
            const response = await request(app)
                .get('/api/gigs')
                .query({ status: 'open' });
            
            expect(response.status).toBe(200);
            expect(response.body.status).toBe('success');
            expect(Array.isArray(response.body.data.gigs)).toBe(true);
            expect(response.body.data.gigs.length).toBeGreaterThan(0);
        });

        test('3. Search gigs by title', async () => {
            const response = await request(app)
                .get('/api/gigs')
                .query({ query: 'React' });
            
            expect(response.status).toBe(200);
            expect(response.body.data.gigs.length).toBeGreaterThan(0);
            expect(response.body.data.gigs[0].title).toContain('React');
        });

        test('4. Get single gig', async () => {
            const response = await request(app)
                .get(`/api/gigs/${testGigId}`)
                .set('Authorization', `Bearer ${authToken}`);
            
            expect(response.status).toBe(200);
            expect(response.body.data.gig._id).toBe(testGigId);
            expect(response.body.data.gig.client.username).toBe('testclient');
        });

        test('5. Update gig', async () => {
            const response = await request(app)
                .patch(`/api/gigs/${testGigId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    title: 'Build a React E-commerce Website - UPDATED',
                    budget: 3000
                });
            
            expect(response.status).toBe(200);
            expect(response.body.data.gig.title).toBe('Build a React E-commerce Website - UPDATED');
            expect(response.body.data.gig.budget).toBe(3000);
        });

        test('6. Get my gigs (as client)', async () => {
            const response = await request(app)
                .get('/api/gigs/my-gigs')
                .set('Authorization', `Bearer ${authToken}`);
            
            expect(response.status).toBe(200);
            expect(response.body.data.gigs.length).toBeGreaterThan(0);
            expect(response.body.data.gigs[0].client._id).toBe(testUserId);
        });
    });

    describe('✅ C. Bidding System (Separate Bid Model)', () => {
        test('1. Submit bid on gig', async () => {
            const response = await request(app)
                .post('/api/bids')
                .set('Authorization', `Bearer ${freelancerToken}`)
                .send({
                    gigId: testGigId,
                    message: 'I have 5 years of experience with React and Node.js. I can build this website within 3 weeks with high quality code and proper testing.',
                    price: 2200,
                    estimatedTime: 21
                });
            
            expect(response.status).toBe(201);
            expect(response.body.status).toBe('success');
            expect(response.body.data.bid).toHaveProperty('status', 'pending');
            expect(response.body.data.bid).toHaveProperty('price', 2200);
            expect(response.body.data.bid.freelancerId.username).toBe('testfreelancer');
            
            testBidId = response.body.data.bid._id;
        });

        test('2. Cannot bid on own gig', async () => {
            const response = await request(app)
                .post('/api/bids')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    gigId: testGigId,
                    message: 'I want to bid on my own gig',
                    price: 1000,
                    estimatedTime: 10
                });
            
            expect(response.status).toBe(400);
            expect(response.body.message).toContain('cannot bid on your own gig');
        });

        test('3. Cannot submit duplicate bid', async () => {
            const response = await request(app)
                .post('/api/bids')
                .set('Authorization', `Bearer ${freelancerToken}`)
                .send({
                    gigId: testGigId,
                    message: 'Another bid from same freelancer',
                    price: 2000,
                    estimatedTime: 20
                });
            
            expect(response.status).toBe(400);
            expect(response.body.message).toContain('already submitted a bid');
        });

        test('4. Get all bids for a specific gig (owner only)', async () => {
            const response = await request(app)
                .get(`/api/bids/${testGigId}`)
                .set('Authorization', `Bearer ${authToken}`);
            
            expect(response.status).toBe(200);
            expect(response.body.results).toBeGreaterThan(0);
            expect(Array.isArray(response.body.data.bids)).toBe(true);
            expect(response.body.data.bids[0].gigId).toBe(testGigId);
        });

        test('5. Unauthorized access to bids', async () => {
            const response = await request(app)
                .get(`/api/bids/${testGigId}`)
                .set('Authorization', `Bearer ${freelancerToken}`);
            
            expect(response.status).toBe(403);
            expect(response.body.message).toContain('not authorized');
        });

        test('6. Get my bids (as freelancer)', async () => {
            const response = await request(app)
                .get('/api/bids/my/bids')
                .set('Authorization', `Bearer ${freelancerToken}`);
            
            expect(response.status).toBe(200);
            expect(response.body.data.bids.length).toBeGreaterThan(0);
            expect(response.body.data.bids[0].freelancerId._id).toBeDefined();
        });
    });

    describe('✅ D. Hiring Logic (Critical - Atomic Operation)', () => {
        test('1. Hire freelancer (atomic operation)', async () => {
            const response = await request(app)
                .patch(`/api/bids/${testBidId}/hire`)
                .set('Authorization', `Bearer ${authToken}`);
            
            expect(response.status).toBe(200);
            expect(response.body.status).toBe('success');
            expect(response.body.message).toContain('hired successfully');
            expect(response.body.data.gig.status).toBe('assigned');
            expect(response.body.data.bid.status).toBe('hired');
        });

        test('2. Verify gig status changed to assigned', async () => {
            const response = await request(app)
                .get(`/api/gigs/${testGigId}`)
                .set('Authorization', `Bearer ${authToken}`);
            
            expect(response.status).toBe(200);
            expect(response.body.data.gig.status).toBe('assigned');
            expect(response.body.data.gig.freelancer).toBeDefined();
        });

        test('3. Verify bid status changed to hired', async () => {
            const response = await request(app)
                .get(`/api/bids/${testGigId}`)
                .set('Authorization', `Bearer ${authToken}`);
            
            expect(response.status).toBe(200);
            
            // Find the hired bid
            const hiredBid = response.body.data.bids.find(bid => bid.status === 'hired');
            expect(hiredBid).toBeDefined();
            expect(hiredBid._id).toBe(testBidId);
        });

        test('4. Cannot hire on non-existent bid', async () => {
            const response = await request(app)
                .patch('/api/bids/507f1f77bcf86cd799439011/hire') // Random ObjectId
                .set('Authorization', `Bearer ${authToken}`);
            
            expect(response.status).toBe(404);
            expect(response.body.message).toContain('Bid not found');
        });

        test('5. Cannot hire if not gig owner', async () => {
            // Create another gig with different user
            const anotherUser = await request(app)
                .post('/api/auth/register')
                .send({
                    username: 'anotherclient',
                    email: 'another@example.com',
                    password: 'Test@123',
                    role: 'client'
                });
            
            const response = await request(app)
                .patch(`/api/bids/${testBidId}/hire`)
                .set('Authorization', `Bearer ${anotherUser.body.token}`);
            
            expect(response.status).toBe(403);
            expect(response.body.message).toContain('Only the gig owner');
        });

        test('6. Cannot double hire (race condition prevention)', async () => {
            const response = await request(app)
                .patch(`/api/bids/${testBidId}/hire`)
                .set('Authorization', `Bearer ${authToken}`);
            
            expect(response.status).toBe(400);
            expect(response.body.message).toContain('no longer accepting hires');
        });

        test('7. Create another gig and test concurrent bidding', async () => {
            // Create another gig
            const newGig = await request(app)
                .post('/api/gigs')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    title: 'Mobile App Development',
                    description: 'Need a mobile app for iOS and Android',
                    category: 'mobile-development',
                    budget: 5000,
                    deadline: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
                    skillsRequired: ['React Native', 'Firebase', 'iOS', 'Android']
                });
            
            const newGigId = newGig.body.data.gig._id;
            
            // Submit multiple bids from different freelancers
            const freelancer2 = await request(app)
                .post('/api/auth/register')
                .send({
                    username: 'freelancer2',
                    email: 'freelancer2@example.com',
                    password: 'Test@123',
                    role: 'freelancer'
                });
            
            const freelancer3 = await request(app)
                .post('/api/auth/register')
                .send({
                    username: 'freelancer3',
                    email: 'freelancer3@example.com',
                    password: 'Test@123',
                    role: 'freelancer'
                });
            
            // Submit bids
            const bid1 = await request(app)
                .post('/api/bids')
                .set('Authorization', `Bearer ${freelancerToken}`)
                .send({
                    gigId: newGigId,
                    message: 'Bid from freelancer1',
                    price: 4000,
                    estimatedTime: 30
                });
            
            const bid2 = await request(app)
                .post('/api/bids')
                .set('Authorization', `Bearer ${freelancer2.body.token}`)
                .send({
                    gigId: newGigId,
                    message: 'Bid from freelancer2',
                    price: 4500,
                    estimatedTime: 25
                });
            
            const bid3 = await request(app)
                .post('/api/bids')
                .set('Authorization', `Bearer ${freelancer3.body.token}`)
                .send({
                    gigId: newGigId,
                    message: 'Bid from freelancer3',
                    price: 3800,
                    estimatedTime: 28
                });
            
            // Hire one freelancer
            const hireResponse = await request(app)
                .patch(`/api/bids/${bid2.body.data.bid._id}/hire`)
                .set('Authorization', `Bearer ${authToken}`);
            
            expect(hireResponse.status).toBe(200);
            
            // Check that other bids are rejected
            const bidsResponse = await request(app)
                .get(`/api/bids/${newGigId}`)
                .set('Authorization', `Bearer ${authToken}`);
            
            const bids = bidsResponse.body.data.bids;
            const hiredCount = bids.filter(b => b.status === 'hired').length;
            const rejectedCount = bids.filter(b => b.status === 'rejected').length;
            
            expect(hiredCount).toBe(1);
            expect(rejectedCount).toBe(2);
        });
    });

    describe('✅ E. Real-time Notifications & Socket.io', () => {
        test('1. Get notifications for freelancer after hire', async () => {
            const response = await request(app)
                .get('/api/notifications')
                .set('Authorization', `Bearer ${freelancerToken}`);
            
            expect(response.status).toBe(200);
            expect(response.body.data.notifications.length).toBeGreaterThan(0);
            
            // Should have hire notification
            const hireNotification = response.body.data.notifications.find(
                n => n.type === 'bid_accepted' || n.type === 'hired'
            );
            
            expect(hireNotification).toBeDefined();
        });

        test('2. Mark notification as read', async () => {
            const notifications = await request(app)
                .get('/api/notifications')
                .set('Authorization', `Bearer ${freelancerToken}`);
            
            if (notifications.body.data.notifications.length > 0) {
                const notificationId = notifications.body.data.notifications[0]._id;
                
                const response = await request(app)
                    .patch('/api/notifications/read')
                    .set('Authorization', `Bearer ${freelancerToken}`)
                    .send({ notificationIds: [notificationId] });
                
                expect(response.status).toBe(200);
            }
        });
    });

    describe('✅ F. Error Handling & Validation', () => {
        test('1. Invalid gig ID format', async () => {
            const response = await request(app)
                .get('/api/gigs/invalid-id-format')
                .set('Authorization', `Bearer ${authToken}`);
            
            expect(response.status).toBe(400);
        });

        test('2. Non-existent gig', async () => {
            const response = await request(app)
                .get('/api/gigs/507f1f77bcf86cd799439011')
                .set('Authorization', `Bearer ${authToken}`);
            
            expect(response.status).toBe(404);
        });

        test('3. Unauthorized access (no token)', async () => {
            const response = await request(app)
                .get('/api/gigs/my-gigs');
            
            expect(response.status).toBe(401);
        });

        test('4. Invalid bid submission (missing fields)', async () => {
            const response = await request(app)
                .post('/api/bids')
                .set('Authorization', `Bearer ${freelancerToken}`)
                .send({
                    gigId: testGigId,
                    // Missing message, price, estimatedTime
                });
            
            expect(response.status).toBe(400);
        });

        test('5. Invalid bid price (negative)', async () => {
            const response = await request(app)
                .post('/api/bids')
                .set('Authorization', `Bearer ${freelancerToken}`)
                .send({
                    gigId: testGigId,
                    message: 'Test bid',
                    price: -100,
                    estimatedTime: 10
                });
            
            expect(response.status).toBe(400);
        });
    });

    describe('✅ G. Health & System Checks', () => {
        test('1. Health check endpoint', async () => {
            const response = await request(app).get('/health');
            
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('status', 'healthy');
            expect(response.body).toHaveProperty('database');
        });

        test('2. API documentation endpoint', async () => {
            const response = await request(app).get('/');
            
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('message');
            expect(response.body).toHaveProperty('endpoints');
        });
    });
});

console.log('\n🎉 All test suites defined! Run with: npm test\n');