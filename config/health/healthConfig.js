// config/healthConfig.js

module.exports = {
    healthCheck: {
        enableVerbose: true, // Define if verbose mode is enabled by default
        includeUptime: true, // Include server uptime in response
        checkInterval: 60000, // Interval between automatic checks (60 seconds)
        responseTimeout: 5000, // Maximum time for a response before timeout
        healthCheckUser: process.env.CLAUD_PROFILE || undefined, // Dedicated user for health checks
    },
    server: {
        memoryThresholds: {
            warning: 85, // Above 85% memory usage generates WARNING
            error: 95,   // Above 95% memory usage generates ERROR
        },
        cpuThresholds: {
            warning: 75, // Above 75% CPU usage generates WARNING
            error: 90,   // Above 90% CPU usage generates ERROR
        },
    },
    database: {
        maxResponseTime: 1000, // If Firestore takes more than 1000ms, generates WARNING
        criticalResponseTime: 2000, // If Firestore takes more than 2000ms, generates ERROR
    },
    externalAPIs: {
        maxResponseTime: 2000, // If external APIs take more than 2000ms, generates WARNING
        criticalResponseTime: 5000, // If external APIs take more than 5000ms, generates ERROR
    },
    storage: {
        maxResponseTime: 1500, // If Firebase Storage takes more than 1500ms, generates WARNING
    },
    authentication: {
        maxResponseTime: 1000, // If Firebase Auth takes more than 1000ms, generates WARNING
        tokenExpirationBuffer: 300,
        healthCheckToken: process.env.HEALTH_CHECK_TOKEN || undefined, // Token for authenticated health checks
    },
    websockets: {
        maxLatency: 500, 
        maxConnections: 5000, // Maximum simultaneous WebSocket connections
    },
    monitoring: {
        enableAlerts: true, // Enable alert sending
        alertChannels: ['slack', 'email'], // Notification channels
        alertThreshold: 'error', // Send alerts for 'error' status (or 'warning' if needed)
        alertInterval: 300000, // Minimum time between alert notifications (5 minutes)
    },
    security: {
        sslCheck: true, // Check SSL certificate validity
        recaptchaCheck: true, // Check if reCAPTCHA service is active
    },
    email: {
        testEmail: 'leolest@gmail.com', // Email for testing notification sending
    },
    payments: {
        enabled: true, // If payments are activated, check the payment API
    },
    publicEndpoints: {
        requireAuth: false, // Public endpoints don't require authentication
        includeDetails: false, // Public endpoints provide minimal details
    },
    app: {
        version: process.env.APP_VERSION || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
    }
};