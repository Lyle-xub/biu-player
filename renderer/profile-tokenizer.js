/* BERT basic tokenizer + greedy WordPiece, shared with background runtimes. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.BiuProfileTokenizer=factory();})(typeof window==='object'?window:this,function(){
  function encode(text,vocab,maxLength=128){
    const pieces=String(text||'').slice(0,2000)
      .replace(/[\u0000\ufffd]/g,'').replace(/[\p{Cc}\p{Cf}]/gu,c=>/[\t\n\r]/.test(c)?' ':'')
      .replace(/([\p{Script=Han}\p{P}\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e])/gu,' $1 ').split(/\s+/).filter(Boolean);
    const ids=[vocab['[CLS]']];
    for(const word of pieces){
      const out=[];let start=0,failed=word.length>100;
      while(start<word.length&&!failed){let end=word.length,match;
        while(end>start){const part=(start?'##':'')+word.slice(start,end);if(vocab[part]!==undefined){match=vocab[part];break;}end--;}
        if(match===undefined){failed=true;break;}out.push(match);start=end;
      }
      ids.push(...(failed?[vocab['[UNK]']]:out));if(ids.length>=maxLength-1)break;
    }
    ids.length=Math.min(ids.length,maxLength-1);ids.push(vocab['[SEP]']);return ids;
  }
  return {encode};
});
