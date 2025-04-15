module.exports.createAuthCookies = (res, tokens) => {
    const { accessToken, refreshToken } = tokens;
    
    const cookieBase = {
      httpOnly: true,
      secure: true,
      path: '/',
      sameSite: process.env.NODE_ENV === 'production' ? 'Strict' : 'None',
      domain: process.env.NODE_ENV === 'production' 
        ? '.eloscloud.com.br' 
        : 'localhost'
    };
  
    res.cookie('accessToken', accessToken, {
      ...cookieBase,
      maxAge: 1 * 60 * 60 * 1000
    });
  
    res.cookie('refreshToken', refreshToken, {
      ...cookieBase,
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
  };