/* ═══ Detecção automática do provedor e do tipo de export ═══ */
(function (BT) {
  function provider(fields, filename = '', sheetNames = []) {
    const t = (fields.join(' ') + ' ' + filename + ' ' + sheetNames.join(' ')).toLowerCase();
    if (/\bvinfo\b|\bvhost\b|rvtools|vsphere|vmware|esxi|vm tools/.test(t)) return 'vmware';
    if (/azure|subscription|resource group|resourcegroup|microsoft\./.test(t)) return 'azure';
    if (/\boci\b|ocid|compartment|oracle|availability domain|shape/.test(t)) return 'oci';
    if (/\baws\b|instance-?id|availability.?zone|\bami\b|vpc-?id|arn:aws/.test(t)) return 'aws';
    if (/\bgcp\b|google|project.?id|machine.?type|\bzone\b/.test(t)) return 'gcp';
    if (/datacenter|cluster|powerstate/.test(t)) return 'vmware';
    return 'generic';
  }

  function kind(fields, sheetNames = []) {
    const t = fields.map((f) => f.toLowerCase()).join(' | ');
    if (sheetNames.some((n) => /^vinfo$/i.test(n)) && sheetNames.some((n) => /^vhost$/i.test(n))) return 'servers';
    if (/resource_type/.test(t) || (/(^|\| )type( \||$)/.test(t) && /resource group|location/.test(t) && !/ip address|private ip/.test(t))) return 'baseline';
    if (/cidr|address ?space|address prefix|vcn|vnet|subnet/.test(t) && !/hostname|instance|vm name|private ip/.test(t)) return 'network';
    if (/bucket|storage account|volume|capacity|size in gb|storage class/.test(t) && !/private ip|ip address|vcpu|ocpu/.test(t)) return 'storage';
    if (/ip|hostname|vm|instance|shape|os|operating|power ?state|lifecycle/.test(t)) return 'servers';
    return 'raw';
  }

  BT.importer.detect = { provider, kind };
})(window.BT);
