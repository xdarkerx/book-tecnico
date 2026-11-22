/* Simula o Microsoft Entra ID para os testes: monta uma resposta SAML com a asserção assinada
 * (como o Entra faz por padrão), usando o certificado de teste saml-idp.crt / saml-idp.key. */
const fs = require('fs');
const path = require('path');
const { SignedXml } = require('xml-crypto');

const key = fs.readFileSync(path.join(__dirname, 'saml-idp.key'), 'utf8');
const cert = fs.readFileSync(path.join(__dirname, 'saml-idp.crt'), 'utf8');
const ISSUER = 'https://sts.windows.net/00000000-0000-0000-0000-000000000000/';

function response({ acs, audience, email, name, groups = [], oid = '11111111-1111-1111-1111-111111111111', tamper = false, notOnOrAfterMs = 5 * 60000 }) {
  const now = new Date(), later = new Date(Date.now() + notOnOrAfterMs), before = new Date(Date.now() - 60000);
  const iso = (d) => d.toISOString();
  const xml = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="_resp${Date.now()}" Version="2.0" IssueInstant="${iso(now)}" Destination="${acs}">`
    + `<saml:Issuer xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">${ISSUER}</saml:Issuer>`
    + `<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>`
    + `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_assert${Date.now()}" Version="2.0" IssueInstant="${iso(now)}">`
    + `<saml:Issuer>${ISSUER}</saml:Issuer>`
    + `<saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${email}</saml:NameID>`
    + `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData NotOnOrAfter="${iso(later)}" Recipient="${acs}"/></saml:SubjectConfirmation></saml:Subject>`
    + `<saml:Conditions NotBefore="${iso(before)}" NotOnOrAfter="${iso(later)}"><saml:AudienceRestriction><saml:Audience>${audience}</saml:Audience></saml:AudienceRestriction></saml:Conditions>`
    + `<saml:AuthnStatement AuthnInstant="${iso(now)}" SessionIndex="_s1"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:Password</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>`
    + `<saml:AttributeStatement>`
    + `<saml:Attribute Name="http://schemas.microsoft.com/identity/claims/displayname"><saml:AttributeValue>${name}</saml:AttributeValue></saml:Attribute>`
    + `<saml:Attribute Name="http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"><saml:AttributeValue>${email}</saml:AttributeValue></saml:Attribute>`
    + `<saml:Attribute Name="http://schemas.microsoft.com/identity/claims/objectidentifier"><saml:AttributeValue>${oid}</saml:AttributeValue></saml:Attribute>`
    + (groups.length ? `<saml:Attribute Name="http://schemas.microsoft.com/ws/2008/06/identity/claims/groups">${groups.map((g) => `<saml:AttributeValue>${g}</saml:AttributeValue>`).join('')}</saml:Attribute>` : '')
    + `</saml:AttributeStatement></saml:Assertion></samlp:Response>`;
  const sig = new SignedXml({ privateKey: key, publicCert: cert, signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256', canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#' });
  sig.addReference({ xpath: "//*[local-name(.)='Assertion']", digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256', transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'] });
  sig.computeSignature(xml, { location: { reference: "//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']", action: 'after' } });
  let signed = sig.getSignedXml();
  if (tamper) signed = signed.replace(email, 'intruso@empresa.com'); // altera depois de assinar
  return Buffer.from(signed).toString('base64');
}

module.exports = { response, cert, ISSUER };
