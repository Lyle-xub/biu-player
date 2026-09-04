#include "Carrier.h"
#include <cassert>
#include <fstream>
int main(){
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
}
