
const { FB } = require('fb');

const getFacebookUserData = async (accessToken) => {
    FB.setAccessToken(accessToken);

    const response = await FB.api('/me', { fields: 'id,name,email' });
    return response;
};

module.exports = {
    getFacebookUserData,
    
};
