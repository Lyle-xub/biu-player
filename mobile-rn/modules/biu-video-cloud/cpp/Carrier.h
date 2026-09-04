#pragma once
#include <array>
#include <cstdint>
#include <vector>
#include <string>
#include <map>
#include "wirehair/wirehair.h"
namespace biu {
constexpr int W=128,H=72,BLOCK=704,PACKET=744;
using Bytes=std::vector<uint8_t>;
using Grid=std::array<uint8_t,W*H>;
class Encoder {
  Bytes message; WirehairCodec codec=nullptr; int count; uint32_t length; std::array<uint8_t,16> sid;
public:
  Encoder(const Bytes&,const std::string&); ~Encoder();
  int frames() const {return count*2;}
  Bytes packet(int index) const;
  Grid grid(int index) const;
};
class Decoder {
  std::string expected; WirehairCodec codec=nullptr; int count=0; uint32_t length=0; std::map<int,Bytes> seen;
public:
  Bytes payload;
  explicit Decoder(const std::string&); ~Decoder();
  bool feed(const Grid& levels);
  bool packet(const Bytes& packet);
  int symbols() const {return int(seen.size());}
};
Grid render(const Bytes&);
Bytes read(const Grid&);
}
