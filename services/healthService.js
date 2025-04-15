// services/healthService.js
const os = require('os');
const {getFirestore, getAuth} = require('../firebaseAdmin')
const { performance } = require('perf_hooks');
const Message = require('../models/Message'); // Importe o seu model de Message
const { logger } = require('../logger');
const healthConfig = require('../config/health/healthConfig');
const userService = require('./userService');
const {
    evaluateThreshold,
    determineOverallStatus,
    logServiceStatus,
    sendAlertsIfNeeded
} = require('../utils/healthUtils');

// Firebase admin is imported conditionally to avoid initialization issues
// let firebaseAdmin = null;

// const getFirebaseAdmin = () => {
//   if (!firebaseAdmin) {
//     try {
//       firebaseAdmin = require('../firebaseAdmin');
//     } catch (error) {
//       logger.error('Failed to initialize Firebase Admin', {
//         service: 'healthService',
//         function: 'getFirebaseAdmin',
//         error: error.message
//       });
//     }
//   }
//   return firebaseAdmin;
// };

/**
 * Performs a basic connectivity check that doesn't require authentication
 * or access to protected resources
 */
const checkPublicServices = async () => {
  try {
    // Check basic server health
    const memoryUsage = process.memoryUsage();
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemoryPercentage = ((totalMemory - freeMemory) / totalMemory) * 100;

    // Simple status assessment
    let status = 'healthy';
    let message = 'API is operational';
    
    // Check if memory usage is above threshold
    if (usedMemoryPercentage > healthConfig.server.memoryThresholds.warning) {
      status = 'degraded';
      message = 'API is operational but memory usage is high';
    }
    
    // Check CPU load
    const loadAverage = os.loadavg()[0];
    const cpuCount = os.cpus().length;
    const loadPercentage = (loadAverage / cpuCount) * 100;
    
    if (loadPercentage > healthConfig.server.cpuThresholds.warning) {
      status = 'degraded';
      message = status === 'degraded' 
        ? 'API is operational but resource usage is high' 
        : 'API is operational but CPU usage is high';
    }

    return {
      status,
      message,
      server: {
        memoryUsage: {
          total: `${Math.round(totalMemory / (1024 * 1024 * 1024))} GB`,
          free: `${Math.round(freeMemory / (1024 * 1024 * 1024))} GB`,
          used: `${Math.round(memoryUsage.rss / (1024 * 1024))} MB`,
          usedPercentage: `${Math.round(usedMemoryPercentage)}%`
        },
        cpu: {
          cores: cpuCount,
          loadAverage: loadAverage.toFixed(2),
          loadPercentage: `${Math.round(loadPercentage)}%`
        },
        uptime: `${Math.floor(os.uptime() / 3600)} hours`,
        process: {
          uptime: `${Math.floor(process.uptime() / 60)} minutes`,
          pid: process.pid,
          nodeVersion: process.version
        }
      }
    };
  } catch (error) {
    logger.error('Error during public health check', {
      service: 'healthService',
      function: 'checkPublicServices',
      error: error.message
    });
    
    return {
      status: 'error',
      message: 'Failed to perform basic health check',
      error: error.message
    };
  }
};

/**
 * Verifies the connection to Firestore using minimal permissions
 */
const checkDatabaseConnection = async (options = {}) => {
    try {
        const startTime = performance.now();
        
        // Get Firebase Admin with lazy loading
        // const admin = getFirebaseAdmin();
        // if (!admin) {
        //     return {
        //         status: 'error',
        //         error: 'Firebase Admin not initialized'
        //     };
        // }
        
        const db = getFirestore();
        
        // For basic check, just ping the database
        if (options.depth === 'basic') {
            // Just check if Firestore is available by attempting a simple operation
            await db.collection('_health_check_').doc('ping').get();
            const responseTime = performance.now() - startTime;
            
            return {
                status: responseTime > healthConfig.database.maxResponseTime ? 'degraded' : 'healthy',
                responseTime: `${responseTime.toFixed(2)} ms`
            };
        }
        
        // For detailed check, attempt to read actual collections
        await db.collection('usuario').limit(1).get();
        const responseTime = performance.now() - startTime;

        const dbStatus = responseTime > healthConfig.database.maxResponseTime ? 'warning' : 'healthy';

        return {
            status: dbStatus,
            responseTime: `${responseTime.toFixed(2)} ms`,
            collections: options.verbose ? await listCollections(db) : undefined
        };
    } catch (error) {
        logger.error('Error connecting to database', { 
            service: 'healthService', 
            function: 'checkDatabaseConnection', 
            error: error.message 
        });
        return { 
            status: 'error', 
            error: error.message 
        };
    }
};

/**
 * Helper to list available collections if verbose mode is enabled
 */
const listCollections = async (db) => {
    try {
        const collections = await db.listCollections();
        return collections.map(col => col.id);
    } catch (error) {
        return ['Error listing collections: ' + error.message];
    }
};

/**
 * Check authentication service with varying levels of detail
 */
const checkAuthService = async (options = {}) => {
    try {
        const { userId, depth = 'basic' } = options;
        const startTime = performance.now();

        // For basic check without auth, just verify Firebase Admin initialization
        if (depth === 'basic' && !userId) {
            // const admin = getFirebaseAdmin();
            // if (!admin) {
            //     return {
            //         status: 'error',
            //         error: 'Firebase Admin not initialized'
            //     };
            // }
            
            try {
                const auth = getAuth();
                return {
                    status: 'healthy',
                    message: 'Auth service initialized',
                    responseTime: `${(performance.now() - startTime).toFixed(2)} ms`
                };
            } catch (error) {
                return {
                    status: 'error',
                    error: 'Auth service initialization failed',
                    details: error.message
                };
            }
        }

        // For authenticated or detailed checks, verify Firebase connection with user ID
        if (userId) {
            const firebaseStatus = await checkFirebaseConnection(userId);
            const responseTime = performance.now() - startTime;
            
            return {
                status: firebaseStatus ? 'healthy' : 'error',
                responseTime: `${responseTime.toFixed(2)} ms`,
                details: {
                    firebase: firebaseStatus ? 'connected' : 'connection failed',
                    userId: userId // Safe to include as we've verified authentication
                }
            };
        }
        
        // Fallback for other scenarios
        return {
            status: 'degraded',
            message: 'Limited auth check (no user ID provided)',
            responseTime: `${(performance.now() - startTime).toFixed(2)} ms`
        };
    } catch (error) {
        logger.error('Error checking auth service', { 
            service: 'healthService', 
            function: 'checkAuthService', 
            error: error.message 
        });
        return { 
            status: 'error', 
            error: error.message 
        };
    }
};

/**
 * Verify Firebase connection for a specific user ID
 */
const checkFirebaseConnection = async (userId) => {
    if (!userId) {
        logger.warn('No user ID provided for Firebase connection check', {
            service: 'healthService',
            function: 'checkFirebaseConnection'
        });
        return false;
    }
    
    try {
        // const admin = getFirebaseAdmin();
        // if (!admin) return false;
        
        const auth = getAuth();
        await auth.getUser(userId);
        return true;
    } catch (error) {
        logger.error('Firebase connection check failed', {
            service: 'healthService',
            function: 'checkFirebaseConnection',
            error: error.message
        });
        return false;
    }
};

/**
 * Check a specific service with error isolation
 */
const checkSpecificService = async (serviceName, options = {}) => {
    const { depth = 'basic', userId, verbose = false } = options;
    
    logger.info(`Checking health of service: ${serviceName}`, {
        service: 'healthService',
        function: 'checkSpecificService',
        serviceName,
        depth
    });

    try {
        // Validate service name
        if (!serviceCheckers[serviceName]) {
            return {
                status: 'error',
                timestamp: new Date().toISOString(),
                service: serviceName,
                error: `Unknown service: ${serviceName}`
            };
        }

        // Execute service check with timing
        const startTime = performance.now();
        const serviceStatus = await serviceCheckers[serviceName]({
            depth,
            userId,
            verbose
        });
        const responseTime = performance.now() - startTime;

        return {
            status: serviceStatus.status,
            timestamp: new Date().toISOString(),
            service: serviceName,
            responseTime: `${responseTime.toFixed(2)}ms`,
            details: serviceStatus.details || {}
        };
    } catch (error) {
        logger.error(`Error checking service: ${serviceName}`, {
            service: 'healthService',
            function: 'checkSpecificService',
            error: error.message
        });

        return {
            status: 'error',
            timestamp: new Date().toISOString(),
            service: serviceName,
            error: error.message
        };
    }
};

/**
 * Check all dependencies with error isolation between them
 */
const checkDependencies = async (options = {}) => {
    const { userId, verbose = false } = options;
    
    logger.info('Checking external dependencies', {
        service: 'healthService',
        function: 'checkDependencies',
        verbose
    });

    const dependencyResults = {};
    const startTime = performance.now();
    
    // Check database with error isolation
    try {
        dependencyResults.database = await checkDatabaseConnection({
            depth: userId ? 'detailed' : 'basic',
            verbose
        });
    } catch (error) {
        dependencyResults.database = { 
            status: 'error', 
            error: error.message 
        };
    }
    
    // Check auth with error isolation
    try {
        dependencyResults.authentication = await checkAuthService({
            userId,
            depth: userId ? 'detailed' : 'basic'
        });
    } catch (error) {
        dependencyResults.authentication = { 
            status: 'error', 
            error: error.message 
        };
    }
    
    // Add more dependencies here with their own try/catch blocks
    
    // Determine overall status
    const statuses = Object.values(dependencyResults).map(r => r.status);
    const overallStatus = statuses.includes('error') ? 'error' :
                         statuses.includes('degraded') || statuses.includes('warning') ? 'degraded' :
                         'healthy';
    
    const responseTime = performance.now() - startTime;
    
    return {
        status: overallStatus,
        timestamp: new Date().toISOString(),
        version: process.env.APP_VERSION || '1.0.0',
        responseTime: `${responseTime.toFixed(2)}ms`,
        dependencies: dependencyResults
    };
};

/**
 * Comprehensive system health check
 */
const checkFullSystem = async (options = {}) => {
    const { userId, verbose = false } = options;
    
    if (!userId) {
        return {
            status: 'error',
            error: 'User ID required for full system check'
        };
    }

    logger.info('Starting full system health check', {
        service: 'healthService',
        function: 'checkFullSystem',
        verbose
    });

    const checks = {};
    const startTime = performance.now();

    // Server resources check
    try {
        checks.server = await checkServerResources();
        logServiceStatus('server', checks.server);
    } catch (error) {
        checks.server = { 
            status: 'error', 
            error: error.message 
        };
    }

    // Database check
    try {
        checks.database = await checkDatabaseConnection({
            depth: 'detailed',
            verbose
        });
        logServiceStatus('database', checks.database);
    } catch (error) {
        checks.database = { 
            status: 'error', 
            error: error.message 
        };
    }

    // Auth service check
    try {
        checks.authentication = await checkAuthService({
            userId,
            depth: 'detailed'
        });
        logServiceStatus('authentication', checks.authentication);
    } catch (error) {
        checks.authentication = { 
            status: 'error', 
            error: error.message 
        };
    }

    // Check all available services
    const serviceNames = Object.keys(serviceCheckers);
    checks.services = {};
    
    for (const name of serviceNames) {
        if (['server', 'database', 'auth'].includes(name)) continue; // Skip already checked
        
        try {
            checks.services[name] = await serviceCheckers[name]({
                depth: 'detailed',
                userId,
                verbose
            });
        } catch (error) {
            checks.services[name] = { 
                status: 'error', 
                error: error.message 
            };
        }
    }

    // Determine overall status
    const allStatuses = [
        checks.server.status,
        checks.database.status,
        checks.authentication.status,
        ...Object.values(checks.services).map(s => s.status)
    ];
    
    const overallStatus = allStatuses.includes('error') ? 'error' :
                         allStatuses.includes('degraded') || allStatuses.includes('warning') ? 'degraded' :
                         'healthy';
    
    const responseTime = performance.now() - startTime;
    
    const healthStatus = {
        status: overallStatus,
        timestamp: new Date().toISOString(),
        version: process.env.APP_VERSION || '1.0.0',
        responseTime: `${responseTime.toFixed(2)}ms`,
        checks: checks
    };
    
    // Send alerts if needed
    sendAlertsIfNeeded(healthStatus);
    
    return healthStatus;
};

/**
 * Check server resources
 */
const checkServerResources = async () => {
    try {
        const totalMemory = os.totalmem();
        const freeMemory = os.freemem();
        const usedMemoryPercentage = ((totalMemory - freeMemory) / totalMemory) * 100;

        const memoryStatus = evaluateThreshold(usedMemoryPercentage, healthConfig.server.memoryThresholds);

        const loadAverage = os.loadavg()[0];
        const cpuCount = os.cpus().length;
        const loadPercentage = (loadAverage / cpuCount) * 100;

        const cpuStatus = evaluateThreshold(loadPercentage, healthConfig.server.cpuThresholds);

        const overallStatus = memoryStatus === 'error' || cpuStatus === 'error' ? 'error' :
                             memoryStatus === 'warning' || cpuStatus === 'warning' ? 'warning' :
                             'healthy';

        const details = {
            message: overallStatus === 'error' 
                ? `⚠️ Critical resource usage: ${memoryStatus === 'error' ? 'Memory above critical limit' : 'CPU above critical limit'}`
                : 'Resources within acceptable limits',
            memory: {
                total: `${Math.round(totalMemory / (1024 * 1024 * 1024))} GB`,
                free: `${Math.round(freeMemory / (1024 * 1024 * 1024))} GB`,
                usedPercentage: `${Math.round(usedMemoryPercentage)}%`,
                status: memoryStatus
            },
            cpu: {
                cores: cpuCount,
                loadAverage: loadAverage.toFixed(2),
                loadPercentage: `${Math.round(loadPercentage)}%`,
                status: cpuStatus
            },
            uptime: `${Math.floor(os.uptime() / 3600)} hours`
        };

        logger.info('Server resources status obtained', {
            service: 'healthService',
            function: 'checkServerResources',
            status: overallStatus
        });

        return {
            status: overallStatus,
            details
        };
    } catch (error) {
        logger.error('Error checking server resources', { 
            service: 'healthService', 
            function: 'checkServerResources', 
            error: error.message, 
            stack: error.stack 
        });

        return { 
            status: 'error', 
            error: error.message
        };
    }
};

/**
 * Check the Caixinha service
 */
const checkCaixinhaService = async (options = {}) => {
    const { depth = 'basic' } = options;
    
    try {
        const startTime = performance.now();
        // const admin = getFirebaseAdmin();
        // if (!admin) {
        //     return {
        //         status: 'error',
        //         error: 'Firebase Admin not initialized'
        //     };
        // }
        
        const db = getFirestore();
        
        // Basic availability check
        if (depth === 'basic') {
            const caixinhaExists = await db.collection('caixinha').limit(1).get()
                .then(snapshot => !snapshot.empty)
                .catch(() => false);
                
            const responseTime = performance.now() - startTime;
            
            return {
                status: caixinhaExists ? 'healthy' : 'error',
                responseTime: `${responseTime.toFixed(2)}ms`,
                details: {
                    message: caixinhaExists ? 'Caixinha collection exists' : 'Caixinha collection not found'
                }
            };
        }
        
        // Detailed check
        const caixinhaRef = await db.collection('caixinha').limit(1).get();
        const responseTime = performance.now() - startTime;
        
        // Performance check
        let status = 'healthy';
        if (responseTime > 800) {
            status = 'error';
        } else if (responseTime > 500) {
            status = 'warning';
        }
        
        return {
            status,
            responseTime: `${responseTime.toFixed(2)}ms`,
            details: {
                message: status === 'healthy' 
                    ? 'Caixinha service operational' 
                    : 'Caixinha service response time degraded',
                collectionExists: !caixinhaRef.empty,
                documents: caixinhaRef.size
            }
        };
    } catch (error) {
        return {
            status: 'error', 
            error: error.message,
            details: {
                message: 'Failed to access Caixinha service'
            }
        };
    }
};

/**
 * Check the Notifications service
 */
const checkNotificationsService = async (options = {}) => {
    const { depth = 'basic' } = options;
    
    try {
        const startTime = performance.now();
        // const admin = getFirebaseAdmin();
        // if (!admin) {
        //     return {
        //         status: 'error',
        //         error: 'Firebase Admin not initialized'
        //     };
        // }
        
        const db = getFirestore();
        
        // Basic check
        const notificationsRef = await db.collection('notificacoes').limit(1).get();

        logger.info(`❤️ User service`, {
            service: 'healthService',
            function: 'checkNotificationsService',
            notificationsRef: notificationsRef.collection('notificacoes')
        });

        const responseTime = performance.now() - startTime;
        
        let status = 'healthy';
        if (responseTime > 800) {
            status = 'error';
        } else if (responseTime > 500) {
            status = 'warning';
        }
        
        // For detailed checks, include more information
        const details = {
            message: status === 'healthy' 
                ? 'Notifications service operational' 
                : 'Notifications service response time degraded',
            collectionExists: !notificationsRef.empty
        };
        
        if (depth === 'detailed') {
            // Get count of unread notifications if available
            try {
                const unreadCount = await db.collection('notificacoes')
                    .where('read', '==', false)
                    .count()
                    .get()
                    .then(snapshot => snapshot.data().count)
                    .catch(() => 'unavailable');
                    
                details.unreadNotifications = unreadCount;
            } catch (innerError) {
                details.unreadNotifications = 'error counting';
            }
        }
        
        return {
            status,
            responseTime: `${responseTime.toFixed(2)}ms`,
            details
        };
    } catch (error) {
        return {
            status: 'error', 
            error: error.message,
            details: {
                message: 'Failed to access Notifications service'
            }
        };
    }
};

/**
 * Check the Users service
 */
const checkUserService = async (options = {}) => {
  const { depth = 'basic', userId } = options;

  try {
      const startTime = performance.now();

      // Basic check - try to fetch a single user (if any exist)
      let user;
      try {
          const users = await userService.getUsers();
          user = users && users.length > 0 ? users[0] : null;
      } catch (error) {
          return {
              status: 'error',
              error: `Failed to fetch users: ${error.message}`
          };
      }

      const responseTime = performance.now() - startTime;

      logger.info(`⏰ User service response time: ${responseTime.toFixed(2)}ms`, {
        service: 'healthService',
        function: 'checkUserService',
        responseTime: responseTime
    });

      // Basic health assessment
      let status = 'healthy';
      const details = {
          message: 'Users service operational',
          collectionExists: user !== null,
          responseTime: `${responseTime.toFixed(2)}ms`
      };

      // Performance check
      if (responseTime > 800) {
          status = 'error';
          details.warning = 'Response time critical for user queries';
      } else if (responseTime > 500) {
          status = 'warning';
          details.warning = 'Response time elevated for user queries';
      }

      // Check if collection appears to be empty
      if (user === null) {
          details.warning = 'Users collection appears to be empty';
          status = status === 'healthy' ? 'warning' : status;
      }

      // Detailed check
      if (depth === 'detailed' && userId) {
          try {
              const specificUser = await userService.getUserById(userId);
              details.userCheck = {
                  userExists: !!specificUser,
                  fields: specificUser ? Object.keys(specificUser).length : 0
              };
          } catch (userError) {
              details.userCheck = {
                  status: 'failed',
                  error: userError.message
              };
          }
      }

      return {
          status,
          details
      };
  } catch (error) {
      logger.error('Error checking Users service', {
          service: 'healthService',
          function: 'checkUserService',
          error: error.message
      });

      return {
          status: 'error',
          error: error.message,
          details: {
              message: 'Failed to access Users service'
          }
      };
  }
};

/**
 * Check the Interests service
 */
const checkInterestsService = async (options = {}) => {
    try {
        const startTime = performance.now();
        
        const db = getFirestore();
        
        // Check access to interests collection
        const interestsQuery = db.collection('interests').limit(1);
        const interestsSnapshot = await interestsQuery.get();
        
        // Check access to categories if they exist
        let categoriesAccessible = false;
        let categoriesResponseTime = 0;
        try {
            const categoriesStartTime = performance.now();
            const categoriesQuery = db.collection('interest_categories').limit(5);
            const categoriesSnapshot = await categoriesQuery.get();
            categoriesResponseTime = performance.now() - categoriesStartTime;
            categoriesAccessible = true;
        } catch (catError) {
            // Categories collection may not exist, which is acceptable
        }
        
        const responseTime = performance.now() - startTime;
        
        // Determine status
        let status = 'healthy';
        const details = {
            message: 'Interests service operational',
            collectionExists: !interestsSnapshot.empty,
            responseTime: `${responseTime.toFixed(2)}ms`,
            categoriesCheck: {
                accessible: categoriesAccessible,
                responseTime: `${categoriesResponseTime.toFixed(2)}ms`
            }
        };
        
        // Performance check
        if (responseTime > 600) {
            status = 'warning';
            details.warning = 'Response time elevated for interests queries';
        }
        
        // Data integrity check
        if (interestsSnapshot.empty) {
            details.warning = 'Interests collection appears to be empty';
            status = status === 'healthy' ? 'warning' : status;
        }
        
        return {
            status,
            details
        };
    } catch (error) {
        logger.error('Error checking Interests service', {
            service: 'healthService',
            function: 'checkInterestsService',
            error: error.message
        });
        
        return {
            status: 'error',
            error: error.message,
            details: {
                message: 'Failed to access Interests service'
            }
        };
    }
};

/**
 * Check the Connections service
 */
const checkConnectionsService = async (options = {}) => {
    try {
        const startTime = performance.now();
        
        const db = getFirestore();
        
        // Check relevant collections for the connections service
        const collections = ['conexoes'];
        const collectionStatuses = {};
        let hasError = false;
        let hasWarning = false;
        
        // Check each collection 
        for (const collName of collections) {
            try {
                const collStartTime = performance.now();
                const collQuery = db.collection(collName).limit(1);
                const collSnapshot = await collQuery.get();
                const collResponseTime = performance.now() - collStartTime;
                
                collectionStatuses[collName] = {
                    accessible: true,
                    empty: collSnapshot.empty,
                    responseTime: `${collResponseTime.toFixed(2)}ms`
                };
                
                // Check performance of each collection
                if (collResponseTime > 500) {
                    collectionStatuses[collName].warning = 'Response time elevated';
                    hasWarning = true;
                }
            } catch (collError) {
                collectionStatuses[collName] = {
                    accessible: false,
                    error: collError.message
                };
                
                // If main connections collection fails, it's a critical error
                if (collName === 'connections') {
                    hasError = true;
                } else {
                    hasWarning = true;
                }
            }
        }
        
        const responseTime = performance.now() - startTime;
        
        // Determine overall status
        let status = hasError ? 'error' : (hasWarning ? 'warning' : 'healthy');
        
        const details = {
            message: status === 'healthy' ? 'Connections service operational' : 
                   (status === 'warning' ? 'Connections service operating in degraded mode' : 
                                         'Connections service has critical failures'),
            totalResponseTime: `${responseTime.toFixed(2)}ms`,
            collections: collectionStatuses
        };
        
        return {
            status,
            details
        };
    } catch (error) {
        logger.error('Error checking Connections service', {
            service: 'healthService',
            function: 'checkConnectionsService',
            error: error.message
        });
        
        return {
            status: 'error',
            error: error.message,
            details: {
                message: 'Failed to access Connections service'
            }
        };
    }
};

/**
 * Check all services
 * @param {string} userId - User ID for authenticated checks
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} - Overall health status
 */
const checkServices = async (userId, options = {}) => {
  const { verbose = false } = options;
  
  logger.info('Initiating health check for all services', {
      service: 'healthService',
      function: 'checkServices',
      verbose,
      userId: userId ? 'provided' : 'missing'
  });

  const checks = {};
  const startTime = performance.now();

  // Check server resources
  try {
      checks.server = await checkServerResources();
      logServiceStatus('server', checks.server);
  } catch (error) {
      checks.server = { 
          status: 'error', 
          error: error.message 
      };
  }

  // Check database connection
  try {
      checks.database = await checkDatabaseConnection({
          depth: userId ? 'detailed' : 'basic',
          verbose
      });
      logServiceStatus('database', checks.database);
  } catch (error) {
      checks.database = { 
          status: 'error', 
          error: error.message 
      };
  }

  // Check authentication
  try {
      checks.authentication = await checkAuthService({
          userId,
          depth: userId ? 'detailed' : 'basic'
      });
      logServiceStatus('authentication', checks.authentication);
  } catch (error) {
      checks.authentication = { 
          status: 'error', 
          error: error.message 
      };
  }

  // Get list of service names excluding those we've already checked
  const serviceNames = Object.keys(serviceCheckers).filter(
      name => !['server', 'database', 'auth'].includes(name)
  );
  
  // Check each remaining service
  for (const serviceName of serviceNames) {
      try {
          checks[serviceName] = await serviceCheckers[serviceName]({
              depth: userId ? 'detailed' : 'basic',
              userId,
              verbose
          });
          logServiceStatus(serviceName, checks[serviceName]);
      } catch (error) {
          checks[serviceName] = { 
              status: 'error', 
              error: error.message 
          };
          logServiceStatus(serviceName, checks[serviceName]);
      }
  }

  // Evaluate overall health status
  const healthStatus = determineOverallStatus(checks);
  
  // Include response time
  healthStatus.responseTime = `${(performance.now() - startTime).toFixed(2)}ms`;
  
  // Send alerts if needed
  sendAlertsIfNeeded(healthStatus);

  return healthStatus;
};

const checkInvitesService = async () => {
    const db = getFirestore();

    logger.info('Executando checagem de saúde do serviço de convites', {
        service: 'healthService',
        function: 'checkInvitesService'
    });

    try {
        // Tentar acessar a coleção de convites de forma básica
        const snapshot = await db.collection('convites').limit(1).get();

        // Verifique se o snapshot foi retornado e se possui a propriedade metadata
        if (snapshot && snapshot.metadata && snapshot.metadata.hasPendingWrites) {
            logger.warn('Checagem de saúde do serviço de convites: Há escritas pendentes no Firestore.', {
                service: 'healthService',
                function: 'checkInvitesService'
            });
            return {
                status: 'degraded',
                message: 'Serviço de convites operacional, mas com escritas pendentes no Firestore.'
            };
        }

        logger.info('Checagem de saúde do serviço de convites concluída com sucesso.', {
            service: 'healthService',
            function: 'checkInvitesService'
        });

        return {
            status: 'healthy',
            message: 'Serviço de convites operacional.'
        };

    } catch (error) {
        logger.error('Erro durante a checagem de saúde do serviço de convites', {
            service: 'healthService',
            function: 'checkInvitesService',
            error: error.message
        });
        return {
            status: 'error',
            message: `Erro ao verificar o serviço de convites: ${error.message}`
        };
    }
};

const checkMessagesService = async (options = {}) => {
    const { depth = 'basic', uidRemetenteTeste, uidDestinatarioTeste } = options;
  
    try {
      const startTime = performance.now();
  
      let mensagemTeste;
      try {
        // Tenta buscar algumas mensagens (se existirem)
        const mensagens = await Message.getByUserId(uidRemetenteTeste || 'teste', uidDestinatarioTeste || 'teste');
        mensagemTeste = mensagens && mensagens.length > 0 ? mensagens[0] : null;
      } catch (error) {
        return {
          status: 'error',
          error: `Falha ao buscar mensagens: ${error.message}`,
        };
      }
  
      const responseTime = performance.now() - startTime;
  
      logger.info(`⏰ Tempo de resposta da rota de mensagens: ${responseTime.toFixed(2)}ms`, {
        service: 'healthService',
        function: 'checkMessagesRoute',
        responseTime: responseTime,
      });
  
      let status = 'healthy';
      const details = {
        message: 'Rota de mensagens operacional',
        mensagensEncontradas: mensagemTeste !== null,
        responseTime: `${responseTime.toFixed(2)}ms`,
      };
  
      // Verificação de performance
      if (responseTime > 800) {
        status = 'error';
        details.warning = 'Tempo de resposta crítico para consultas de mensagens';
      } else if (responseTime > 500) {
        status = 'warning';
        details.warning = 'Tempo de resposta elevado para consultas de mensagens';
      }
  
      // Verifica se não encontrou mensagens (pode ser normal em um ambiente novo)
      if (mensagemTeste === null) {
        details.warning = 'Nenhuma mensagem encontrada para os IDs de teste';
        status = status === 'healthy' ? 'warning' : status;
      }
  
      // Teste detalhado - tenta criar e deletar uma mensagem
      if (depth === 'detailed' && uidRemetenteTeste && uidDestinatarioTeste) {
        const testData = {
          uidRemetente: uidRemetenteTeste,
          uidDestinatario: uidDestinatarioTeste,
          conteudo: 'Teste de saúde',
          mensagem: 'Teste de saúde',
          tipo: 'texto',
          timestamp: Date.now(),
        };
  
        try {
          const novaMensagem = await Message.create(testData);
          details.createTest = { status: 'success', messageId: novaMensagem.id };
  
          await Message.delete(uidRemetenteTeste, uidDestinatarioTeste, novaMensagem.id);
          details.deleteTest = { status: 'success', messageId: novaMensagem.id };
        } catch (testError) {
          details.createTest = { status: 'failed', error: testError.message };
          details.deleteTest = { status: 'failed', error: testError.message };
          status = 'error';
        }
      }
  
      return {
        status,
        details,
      };
    } catch (error) {
      logger.error('Erro ao verificar a rota de mensagens', {
        service: 'healthService',
        function: 'checkMessagesRoute',
        error: error.message,
      });
      return {
        status: 'error',
        error: error.message,
        details: {
          message: 'Falha ao acessar a rota de mensagens',
        },
      };
    }
  };

/**
 * Map service names to their check functions
 */
const serviceCheckers = {
    'server': checkServerResources,
    'database': checkDatabaseConnection,
    'auth': checkAuthService,
    'messages': checkMessagesService,
    'caixinha': checkCaixinhaService,
    'notifications': checkNotificationsService,
    'user': checkUserService,
    'invites': checkInvitesService,
    'interests': checkInterestsService,
    'connections': checkConnectionsService
    // Add more services as needed
};

module.exports = {
    checkServices,
    checkSpecificService,
    checkDependencies,
    checkPublicServices,
    checkFullSystem
};