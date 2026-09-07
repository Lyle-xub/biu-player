#pragma once
#include <array>
#include <cstdint>
#include <vector>
#include <string>
#include <map>
#include <memory>
#include "wirehair/wirehair.h"
namespace biu {
constexpr int W=128,H=72,BLOCK=704,PACKET=744;
using Bytes=std::vector<uint8_t>;
using Grid=std::array<uint8_t,W*H>;
class Encoder {
  Bytes message; mutable Bytes tail; mutable WirehairCodec codec=nullptr; mutable int codecGroup=-1; int count; uint32_t length; bool segmented; std::array<uint8_t,16> sid;
public:
  Encoder(const Bytes&,const std::string&); ~Encoder();
  int frames() const {return count*2;}
  Bytes packet(int index) const;
  Grid grid(int index) const;
};
class Decoder {
  struct Group {
    WirehairCodec codec=nullptr; std::map<uint32_t,Bytes> seen; Bytes recovered;
    ~Group(){if(codec)wirehair_free(codec);}
  };
  std::string expected; int count=0,version=0,totalSymbols=0; uint32_t length=0;
  std::map<uint32_t,std::unique_ptr<Group>> groups;
public:
  Bytes payload;
  explicit Decoder(const std::string&); ~Decoder();
  bool feed(const Grid& levels);
  bool packet(const Bytes& packet);
  int symbols() const {return totalSymbols;}
};
Grid render(const Bytes&);
Bytes read(const Grid&);
}
