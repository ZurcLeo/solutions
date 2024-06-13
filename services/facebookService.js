const axios = require('axios');
const { FB } = require('fb');

const getFacebookUserData = async (accessToken) => {
    FB.setAccessToken(accessToken);

    const response = await FB.api('/me', { fields: 'id,name,email' });
    return response;
};

const getFacebookFriends = async (accessToken) => {
    const response = await axios.get(`https://graph.facebook.com/me/friends?access_token=${accessToken}`);
    return response.data;
};

module.exports = {
    getFacebookUserData,
    getFacebookFriends,
};
