const mongoose = require('mongoose');
const { logger } = require('../middleware/errorHandler');

class Database {
    constructor() {
        this.connection = null;
        this.isConnected = false;
        this.retryCount = 0;
        this.maxRetries = 5;
        this.retryDelay = 5000; // 5 seconds
    }

    async connect() {
        try {
            if (this.isConnected) {
                logger.info('Using existing database connection');
                return this.connection;
            }

            const options = {
                maxPoolSize: 10,
                serverSelectionTimeoutMS: 5000,
                socketTimeoutMS: 45000,
                family: 4,
                heartbeatFrequencyMS: 30000,
                retryWrites: true,
                retryReads: true
            };

            logger.info('Connecting to MongoDB...');
            
            this.connection = await mongoose.connect(process.env.MONGODB_URI, options);
            this.isConnected = true;
            this.retryCount = 0;

            mongoose.connection.on('connected', () => {
                logger.info('MongoDB connected successfully');
            });

            mongoose.connection.on('error', (err) => {
                logger.error('MongoDB connection error:', err);
                this.isConnected = false;
                this.handleConnectionError();
            });

            mongoose.connection.on('disconnected', () => {
                logger.warn('MongoDB disconnected');
                this.isConnected = false;
                this.handleConnectionError();
            });

            mongoose.connection.on('reconnected', () => {
                logger.info('MongoDB reconnected');
                this.isConnected = true;
            });

            // Graceful shutdown
            process.on('SIGINT', this.gracefulShutdown);
            process.on('SIGTERM', this.gracefulShutdown);

            return this.connection;
        } catch (error) {
            logger.error('Failed to connect to MongoDB:', error);
            this.handleConnectionError();
            throw error;
        }
    }

    async handleConnectionError() {
        this.retryCount++;
        
        if (this.retryCount <= this.maxRetries) {
            logger.warn(`Retrying connection (${this.retryCount}/${this.maxRetries}) in ${this.retryDelay}ms...`);
            
            setTimeout(async () => {
                try {
                    await this.connect();
                } catch (error) {
                    if (this.retryCount === this.maxRetries) {
                        logger.error('Max retries reached. Could not connect to MongoDB.');
                        process.exit(1);
                    }
                }
            }, this.retryDelay);
        } else {
            logger.error('Max retries reached. Could not connect to MongoDB.');
            process.exit(1);
        }
    }

    async gracefulShutdown() {
        logger.info('Shutting down MongoDB connection...');
        
        try {
            await mongoose.connection.close();
            logger.info('MongoDB connection closed gracefully');
            process.exit(0);
        } catch (error) {
            logger.error('Error during MongoDB graceful shutdown:', error);
            process.exit(1);
        }
    }

    async getConnectionStats() {
        if (!this.isConnected) {
            return { status: 'disconnected' };
        }

        const adminDb = mongoose.connection.db.admin();
        const serverStatus = await adminDb.serverStatus();
        
        const stats = {
            status: 'connected',
            host: mongoose.connection.host,
            port: mongoose.connection.port,
            database: mongoose.connection.name,
            collections: await mongoose.connection.db.listCollections().toArray(),
            connections: serverStatus.connections,
            memory: serverStatus.mem,
            network: serverStatus.network,
            operations: serverStatus.opcounters
        };

        return stats;
    }

    async createIndexes() {
        if (!this.isConnected) {
            throw new Error('Database not connected');
        }

        logger.info('Creating database indexes...');
        
        try {
            // User indexes
            await mongoose.model('User').createIndexes();
            
            // Gig indexes
            await mongoose.model('Gig').createIndexes();
            
            // Message indexes
            await mongoose.model('Message').createIndexes();
            
            // Notification indexes
            await mongoose.model('Notification').createIndexes();
            
            // Transaction indexes
            await mongoose.model('Transaction').createIndexes();
            
            // Review indexes
            await mongoose.model('Review').createIndexes();
            
            logger.info('Database indexes created successfully');
        } catch (error) {
            logger.error('Error creating database indexes:', error);
            throw error;
        }
    }

    async startSession() {
        if (!this.isConnected) {
            throw new Error('Database not connected');
        }
        
        return mongoose.startSession();
    }

    async withTransaction(callback) {
        const session = await this.startSession();
        
        try {
            let result;
            await session.withTransaction(async () => {
                result = await callback(session);
            });
            
            await session.endSession();
            return result;
        } catch (error) {
            await session.endSession();
            throw error;
        }
    }

    async ping() {
        try {
            await mongoose.connection.db.command({ ping: 1 });
            return { status: 'ok', latency: Date.now() };
        } catch (error) {
            return { status: 'error', error: error.message };
        }
    }

    async backup() {
        // This would implement backup logic
        // For production, use mongodump or cloud backup services
        logger.warn('Database backup not implemented. Use mongodump for backups.');
        return { status: 'not_implemented' };
    }

    async restore(backupFile) {
        // This would implement restore logic
        logger.warn('Database restore not implemented. Use mongorestore for restoration.');
        return { status: 'not_implemented' };
    }
}

module.exports = new Database();
