#include "Carrier.h"
#include <cassert>
#include <fstream>
#include <iterator>
#include <algorithm>
int main(int argc,char** argv){
 if(argc==5){
  std::ifstream input(argv[2],std::ios::binary);biu::Bytes data((std::istreambuf_iterator<char>(input)),{});
  std::ofstream output(argv[4],std::ios::binary);
  if(std::string(argv[1])=="encode"){
   biu::Encoder encoder(data,argv[3]);for(int i=0;i<encoder.frames();i++){auto p=encoder.packet(i);output.write((char*)p.data(),p.size());}
  }else{
   biu::Decoder decoder(argv[3]);for(size_t i=0;i+biu::PACKET<=data.size();i+=biu::PACKET){if(decoder.packet(biu::Bytes(data.begin()+i,data.begin()+i+biu::PACKET)))break;}
   assert(!decoder.payload.empty());output.write((char*)decoder.payload.data(),decoder.payload.size());
  }
  return 0;
 }

 biu::Bytes data(12000);for(int i=0;i<12000;i++)data[i]=(i*31+i/5)%256;
 std::string sid="0123456789abcdef0123456789abcdef";
 biu::Encoder encoder(data,sid);biu::Decoder decoder(sid);
 for(int i=0;i<encoder.frames();i++){
  auto packet=encoder.packet(i);auto grid=biu::render(packet);
  assert(biu::read(grid)==packet);
  // 20 damaged cells still recover through the interleaved RS codewords.
  for(int j=0;j<20;j++)grid[(20+j)*128+35]^=255;
  assert(biu::read(grid)==packet);
  if(i%3!=0&&decoder.feed(grid))break;
 }
 assert(decoder.payload==data);
 for(size_t size: {size_t(1024*biu::BLOCK+1),size_t(2*1024*biu::BLOCK+5000)}){
  biu::Bytes large(size);for(size_t i=0;i<size;i++)large[i]=(i*31+i/5)%256;
  biu::Encoder enc(large,sid);biu::Decoder dec(sid);
  assert(enc.packet(0)[4]==3);
  // Drop one fifth of each group plus the final one-block tail's systematic symbol.
  for(int i=0;i<enc.frames();i++)if(i%5!=0 && !(size==1024*biu::BLOCK+1 && i==2048))if(dec.packet(enc.packet(i)))break;
  assert(dec.payload==large);
 }
}
