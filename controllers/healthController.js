// controllers/healthController.js
const os = require('os');
const { performance } = require('perf_hooks');
const { logger } = require('../logger');
const healthConfig = require('../config/health/healthConfig');
const { 
  checkServices,
  checkSpecificService, 
  checkDependencies,
  checkPublicServices,
  checkFullSystem
} = require('../services/healthService');

/**
 * @swagger
 * /api/health/public:
 *   get:
 *     summary: Basic health check for the API
 *     description: Simple connectivity check that doesn't require authentication
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: API is reachable
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 timestamp:
 *                   type: string
 *                 version:
 *                   type: string
 */
const publicHealthCheck = async (req, res) => {
  try {
    logger.info('🔍 Basic health check initiated', {
      service: 'health',
      function: 'publicHealthCheck'
    });

    const startTime = performance.now();
    const publicStatus = await checkPublicServices();
    const responseTime = performance.now() - startTime;
    
    publicStatus.responseTime = `${responseTime.toFixed(2)}ms`;
    
    // Adicionar informações de proxy para debug
    const proxyInfo = {
      headers: {
        'x-forwarded-for': req.headers['x-forwarded-for'],
        'x-forwarded-proto': req.headers['x-forwarded-proto'],
        'x-forwarded-host': req.headers['x-forwarded-host'],
        'x-real-ip': req.headers['x-real-ip'],
        origin: req.headers.origin,
        host: req.headers.host,
        'user-agent': req.headers['user-agent']
      },
      connection: {
        ip: req.ip,
        ips: req.ips,
        secure: req.secure,
        protocol: req.protocol
      },
      app: {
        trustProxy: req.app.get('trust proxy'),
        env: process.env.NODE_ENV
      }
    };

    res.status(200).json({
      ...publicStatus,
      proxy: proxyInfo,
      timestamp: new Date().toISOString(),
      version: process.env.APP_VERSION || '1.0.0',
      uptime: `${Math.floor(os.uptime() / 3600)} hours`,
      memoryUsage: process.memoryUsage().rss / (1024 * 1024) + ' MB'
    });
    
    logger.info('✅ Basic health check completed', {
      service: 'health',
      function: 'publicHealthCheck',
      responseTime: publicStatus.responseTime
    });
  } catch (error) {
    logger.error('❌ Error during basic health check', {
      service: 'health',
      function: 'publicHealthCheck',
      error: error.message
    });
    
    res.status(500).json({
      status: 'error',
      message: 'Health check failed',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
};

/**
 * @swagger
 * /api/health/service/{serviceName}:
 *   get:
 *     summary: Check health of a specific service
 *     description: Verifies the operational status of a specific service
 *     tags: [Health]
 *     parameters:
 *       - in: path
 *         name: serviceName
 *         required: true
 *         schema:
 *           type: string
 *         description: Name of the service to check
 *       - in: query
 *         name: depth
 *         schema:
 *           type: string
 *           enum: [basic, detailed]
 *         description: Depth of health check to perform
 *     responses:
 *       200:
 *         description: Service is healthy
 *       207:
 *         description: Service is degraded
 *       503:
 *         description: Service is unhealthy
 */
const serviceHealthCheck = async (req, res) => {
  try {
    const { serviceName } = req.params;
    const depth = req.query.depth || 'basic';
    const isAuthenticated = req.isAuthenticated === true;
    const requestId = req.headers['x-request-id'] || `health-${Date.now()}`;

    logger.info(`🔍 Health check initiated for service: ${serviceName}`, {
      service: 'health',
      function: 'serviceHealthCheck',
      serviceName,
      depth,
      isAuthenticated,
      requestId,
    });

    // For enhanced checks, we need authentication
    if (depth === 'detailed' && !isAuthenticated) {
      logger.warn(`⚠️ Detailed health check requested for ${serviceName} without authentication.`, {
        service: 'health',
        function: 'serviceHealthCheck',
        serviceName,
        depth,
        requestId,
      });
      return res.status(401).json({
        status: 'error',
        message: 'Authentication required for detailed health checks',
        timestamp: new Date().toISOString(),
        requestId,
      });
    }

    let serviceStatus;
    try {
      serviceStatus = await checkSpecificService(serviceName, {
        depth,
        userId: req.user?.uid, // Only available if authenticated
        requestId,
      });
    } catch (checkError) {
      logger.error(`🚨 Error occurred while checking the health of service ${serviceName}.`, {
        service: 'health',
        function: 'serviceHealthCheck',
        serviceName,
        requestId,
        error: checkError.message,
        stack: checkError.stack,
      });
      return res.status(500).json({
        status: 'error',
        message: `❌ Failed to check service: ${serviceName}`,
        timestamp: new Date().toISOString(),
        requestId,
        error: checkError.message,
      });
    }

    const httpStatus = serviceStatus.status === 'healthy' ? 200 :
                      serviceStatus.status === 'degraded' ? 207 : 503;

    res.status(httpStatus).json({
      ...serviceStatus,
      authenticated: isAuthenticated,
      timestamp: new Date().toISOString(),
      requestId,
    });

    logger.info(`✅ Health check completed for service: ${serviceName}. Status: ${serviceStatus.status}`, {
      service: 'health',
      function: 'serviceHealthCheck',
      status: serviceStatus.status,
      httpStatus,
      requestId,
    });

  } catch (error) {
    logger.error('🔥 Unexpected error during service health check process.', {
      service: 'health',
      function: 'serviceHealthCheck',
      serviceName: req.params.serviceName,
      requestId: req.headers['x-request-id'] || `health-${Date.now()}`,
      error: error.message,
      stack: error.stack,
    });
    // Consider if you want to send an error response here if the overall process fails.
    // If the checkSpecificService already handles errors, this might be redundant for the service check itself.
    // However, this catch block handles errors in the health check controller logic itself.
    res.status(500).json({
      status: 'error',
      message: `🔥 Internal error during health check for service: ${req.params.serviceName}`,
      timestamp: new Date().toISOString(),
      requestId: req.headers['x-request-id'] || `health-${Date.now()}`,
      error: error.message,
    });
  }
};

/**
 * @swagger
 * /api/health/dependencies:
 *   get:
 *     summary: Check health of external dependencies
 *     description: Verifies connections to external services
 *     tags: [Health]
 *     parameters:
 *       - in: query
 *         name: verbose
 *         schema:
 *           type: boolean
 *         description: Whether to include detailed information
 *     responses:
 *       200:
 *         description: All dependencies are healthy
 *       207:
 *         description: Some dependencies are degraded
 *       503:
 *         description: Critical dependencies are unhealthy
 */
const dependenciesHealthCheck = async (req, res) => {
  try {
    const isAuthenticated = req.isAuthenticated === true;
    const verbose = req.query.verbose === 'true';
    
    logger.info('🔍 Dependencies health check initiated', {
      service: 'health',
      function: 'dependenciesHealthCheck',
      isAuthenticated,
      verbose
    });

    const dependenciesStatus = await checkDependencies({
      userId: req.user?.uid,
      verbose
    });
    
    const httpStatus = dependenciesStatus.status === 'healthy' ? 200 : 
                      dependenciesStatus.status === 'degraded' ? 207 : 503;

    res.status(httpStatus).json({
      ...dependenciesStatus,
      authenticated: isAuthenticated,
      timestamp: new Date().toISOString()
    });
    
    logger.info('✅ Dependencies health check completed', {
      service: 'health',
      function: 'dependenciesHealthCheck',
      status: dependenciesStatus.status
    });
  } catch (error) {
    logger.error('❌ Error during dependencies health check', {
      service: 'health',
      function: 'dependenciesHealthCheck',
      error: error.message
    });

    res.status(500).json({
      status: 'error',
      message: 'Failed to check dependencies',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
};

/**
 * @swagger
 * /api/health/full:
 *   get:
 *     summary: Complete system health check
 *     description: Comprehensive check of all system components
 *     tags: [Health]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: verbose
 *         schema:
 *           type: boolean
 *         description: Whether to include detailed information
 *     responses:
 *       200:
 *         description: System is healthy
 *       207:
 *         description: System is degraded
 *       503:
 *         description: System is unhealthy
 */
const fullSystemHealthCheck = async (req, res) => {
  const userId = req.user?.uid;
  const verbose = req.query.verbose === 'true';

  try {
    logger.info('🔍 Full system health check initiated', {
      service: 'health',
      function: 'fullSystemHealthCheck',
      verbose,
      userId
    });
  
    const healthStatus = await checkFullSystem({
      userId,
      verbose,
      requestId: req.headers['x-request-id'] || `health-${Date.now()}`
    });
    
    const httpStatus = healthStatus.status === 'healthy' ? 200 : 
                      healthStatus.status === 'degraded' ? 207 : 503;

    res.status(httpStatus).json({
      ...healthStatus,
      timestamp: new Date().toISOString()
    });
    
    logger.info('✅ Full system health check completed', {
      service: 'health',
      function: 'fullSystemHealthCheck',
      status: healthStatus.status,
      httpStatus
    });
  } catch (error) {
    logger.error('❌ Error during full system health check', {
      service: 'health',
      function: 'fullSystemHealthCheck',
      error: error.message,
      stack: error.stack
    });

    res.status(500).json({
      status: 'error',
      message: 'Failed to complete system health check',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
};

module.exports = {
  publicHealthCheck,
  serviceHealthCheck,
  dependenciesHealthCheck,
  fullSystemHealthCheck
};