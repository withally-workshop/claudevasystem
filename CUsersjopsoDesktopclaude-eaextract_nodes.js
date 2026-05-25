const fs = require('fs');
const data = JSON.parse(fs.readFileSync('C:\Users\jopso\.claude\projects\c--Users-jopso-Desktop-claude-ea\6c522004-c0eb-4513-89b9-beb505230c37\tool-results\b2im1y86i.txt', 'utf8'));

data.nodes.forEach(node => {
  if (node.id === 'n3') {
    console.log('\n' + '='.repeat(80));
    console.log('NODE ID: n3 | NAME: ' + node.name);
    console.log('TYPE: ' + node.type);
    console.log('='.repeat(80) + '\n');
    if (node.parameters?.jsCode) {
      console.log(node.parameters.jsCode);
    }
    console.log('\n');
  }
});

data.nodes.forEach(node => {
  if (node.name === 'Match Deposits To Invoices') {
    console.log('\n' + '='.repeat(80));
    console.log('NODE: ' + node.name + ' | ID: ' + node.id);
    console.log('TYPE: ' + node.type);
    console.log('='.repeat(80) + '\n');
    if (node.parameters?.jsCode) {
      console.log(node.parameters.jsCode);
    }
    console.log('\n');
  }
});
