const prepareSearchTerms = (text) => {
    if (!text) return [];
    const searchTerms = [
      text.toLowerCase(),
      ...text.toLowerCase().split(' ')
    ];
    return [...new Set(searchTerms)].filter(term => term.length > 2);
  };
  
  module.exports = { prepareSearchTerms };