//   // Método para pesquisar interesses em múltiplas categorias
//   class InterestsService {
//     static getAvailableInterests() {
//       const allInterests = [];
//       for (const category in availableInterests) {
//           availableInterests[category].forEach(interest => {
//               allInterests.push({ ...interest, category });
//           });
//       }
//       return allInterests;
//   }

//   static getInterestById(id) {
//       for (const category in availableInterests) {
//           const interest = availableInterests[category].find(item => item.id === id);
//           if (interest) return interest;
//       }
//       return null;
//   }

//   static searchInterests(query) {
//       const results = [];
//       const searchTerm = query.toLowerCase();

//       for (const category in availableInterests) {
//           const matches = availableInterests[category].filter(
//               item => item.label.toLowerCase().includes(searchTerm)
//           );
//           results.push(...matches);
//       }

//       return results;
//   }

//   static getAllInterestsFlat() {
//       const allInterests = [];
//       for (const category in availableInterests) {
//           allInterests.push(...availableInterests[category]);
//       }
//       return allInterests;
//   }
// }
  
//   module.exports = InterestsService;