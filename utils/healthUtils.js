// utils/healthUtils.js
const { logger } = require('../logger');
const healthConfig = require('../config/health/healthConfig');

/**
 * Evaluates a metric value against defined thresholds
 * @param {number} value - The metric value to evaluate
 * @param {Object} thresholds - Object containing warning and error thresholds
 * @returns {string} - Status level: 'healthy', 'warning', or 'error'
 */
const evaluateThreshold = (value, thresholds) => {
    if (value >= thresholds.error) {
        return 'error';
    } else if (value >= thresholds.warning) {
        return 'warning';
    }
    return 'healthy';
};

/**
 * Determines the overall status based on multiple service checks
 * @param {Object} checks - Object containing multiple service check results
 * @returns {Object} - Overall health status report
 */
const determineOverallStatus = (checks) => {
    // Extract status from each service
    const statuses = Object.values(checks).map(check => check.status);
    
    // Determine the worst status
    const overallStatus = statuses.includes('error') ? 'error' : 
                         statuses.includes('warning') ? 'warning' : 
                         'healthy';
    
    // Identify unhealthy services
    const unhealthyServices = [];
    for (const [service, check] of Object.entries(checks)) {
        if (check.status !== 'healthy') {
            unhealthyServices.push({
                service,
                status: check.status,
                details: check.details || check.error || ''
            });
        }
    }
    
    return {
        status: overallStatus,
        timestamp: new Date().toISOString(),
        version: process.env.APP_VERSION || '1.0.0',
        checks: checks,
        unhealthyServices: unhealthyServices.length > 0 ? unhealthyServices : undefined
    };
};

/**
 * Logs the status of a service
 * @param {string} serviceName - Name of the service 
 * @param {Object} status - Status result from the service check
 */
const logServiceStatus = (serviceName, status) => {
    if (status.status === 'error') {
        logger.error(`🔴 Health check for ${serviceName}: ERROR`, {
            service: 'healthUtils',
            function: 'logServiceStatus',
            serviceName,
            status: status.status,
            details: status.details || status.error
        });
    } else if (status.status === 'warning' || status.status === 'degraded') {
        logger.warn(`🟠 Health check for ${serviceName}: ${status.status.toUpperCase()}`, {
            service: 'healthUtils',
            function: 'logServiceStatus',
            serviceName,
            status: status.status,
            details: status.details
        });
    } else {
        logger.info(`🟢 Health check for ${serviceName}: HEALTHY`, {
            service: 'healthUtils',
            function: 'logServiceStatus',
            serviceName,
            status: status.status
        });
    }
};

// Track last alert time to prevent alert storms
let lastAlertTime = 0;

/**
 * Sends alerts for unhealthy services if configured
 * @param {Object} healthStatus - Health status report
 */
const sendAlertsIfNeeded = (healthStatus) => {
    // Skip if alerts are disabled
    if (!healthConfig.monitoring.enableAlerts) {
        return;
    }
    
    // Check if we should alert based on threshold
    const shouldAlert = 
        healthStatus.status === 'error' || 
        (healthConfig.monitoring.alertThreshold === 'warning' && healthStatus.status === 'warning');
    
    if (!shouldAlert) {
        return;
    }
    
    // Prevent alert storms by checking the time interval
    const now = Date.now();
    if (now - lastAlertTime < healthConfig.monitoring.alertInterval) {
        logger.info('Alert suppressed due to rate limiting', {
            service: 'healthUtils',
            function: 'sendAlertsIfNeeded',
            timeSinceLastAlert: (now - lastAlertTime) / 1000 + 's'
        });
        return;
    }
    
    // Update last alert time
    lastAlertTime = now;
    
    // Log the alert (in a real system, this would send to configured channels)
    logger.warn(`🚨 HEALTH ALERT: System status is ${healthStatus.status.toUpperCase()}`, {
        service: 'healthUtils',
        function: 'sendAlertsIfNeeded',
        status: healthStatus.status,
        timestamp: healthStatus.timestamp,
        unhealthyServices: healthStatus.unhealthyServices || []
    });
    
    // Here you would implement code to send to Slack, email, etc.
    // For example:
    /*
    if (healthConfig.monitoring.alertChannels.includes('slack')) {
        sendSlackAlert(healthStatus);
    }
    
    if (healthConfig.monitoring.alertChannels.includes('email')) {
        sendEmailAlert(healthStatus);
    }
    */
};

/**
 * Creates a health check payload with consistent structure
 * @param {string} status - Status of the check
 * @param {Object} details - Details of the check
 * @returns {Object} - Formatted health check result
 */
const createHealthResponse = (status, details = {}) => {
    return {
        status: status,
        timestamp: new Date().toISOString(),
        details: details
    };
};

/**
 * Formats error information for health check responses
 * @param {Error} error - The error object
 * @returns {Object} - Formatted error information
 */
const formatErrorForHealthResponse = (error) => {
    return {
        message: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    };
};

module.exports = {
    evaluateThreshold,
    determineOverallStatus,
    logServiceStatus,
    sendAlertsIfNeeded,
    createHealthResponse,
    formatErrorForHealthResponse
};