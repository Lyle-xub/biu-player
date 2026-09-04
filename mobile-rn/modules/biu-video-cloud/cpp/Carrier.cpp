#include "Carrier.h"
#include <algorithm>
#include <cmath>
#include <cstring>
#include <mutex>
#include <stdexcept>
namespace biu {
static void require(bool ok,const char* message){if(!ok)throw std::runtime_error(message);}
static std::array<uint8_t,16> parseSid(const std::string& s){
 require(s.size()==32,"Invalid snapshot ID");std::array<uint8_t,16> bytes{};
 auto nib=[](char c){if(c>='0'&&c<='9')return c-'0';if(c>='a'&&c<='f')return c-'a'+10;throw std::runtime_error("Invalid snapshot ID");};
 for(int i=0;i<16;i++)bytes[i]=(nib(s[i*2])<<4)|nib(s[i*2+1]);return bytes;
}
static void initWire(){static std::once_flag flag;std::call_once(flag,[]{require(wirehair_init()==Wirehair_Success,"Wirehair unavailable");});}
static uint32_t get32(const uint8_t* p){return uint32_t(p[0])|uint32_t(p[1])<<8|uint32_t(p[2])<<16|uint32_t(p[3])<<24;}
static void put32(uint8_t* p,uint32_t v){for(int i=0;i<4;i++)p[i]=v>>(i*8);}
static uint32_t crc(const Bytes& data){uint32_t c=~0u;for(auto b:data){c^=b;for(int i=0;i<8;i++)c=(c>>1)^(0xedb88320u&uint32_t(-int(c&1)));}return ~c;}
struct GF {
 uint8_t exp[512]{},log[256]{};
 GF(){int x=1;for(int i=0;i<255;i++){exp[i]=x;log[x]=i;x<<=1;if(x&256)x^=0x11d;}for(int i=255;i<512;i++)exp[i]=exp[i-255];}
 uint8_t mul(int a,int b)const{return a&&b?exp[log[a]+log[b]]:0;}
 uint8_t div(int a,int b)const{require(b,"RS division by zero");return a?exp[(int(log[a])-log[b]+255)%255]:0;}
 uint8_t eval(const Bytes& p,uint8_t x)const{uint8_t y=0;for(auto c:p)y=mul(y,x)^c;return y;}
};
static const GF gf;
static Bytes parity(const Bytes& message){
 Bytes gen{1};for(int i=0;i<64;i++){Bytes next(gen.size()+1);for(size_t j=0;j<gen.size();j++){next[j]^=gen[j];next[j+1]^=gf.mul(gen[j],gf.exp[i]);}gen=next;}
 Bytes out=message;out.resize(255);for(int i=0;i<191;i++){auto c=out[i];for(int j=1;c&&j<=64;j++)out[i+j]^=gf.mul(gen[j],c);}std::copy(message.begin(),message.end(),out.begin());return out;
}
static bool correct(Bytes& word){
 Bytes synd(64);bool zero=true;for(int i=0;i<64;i++){synd[i]=gf.eval(word,gf.exp[i]);zero&=synd[i]==0;}if(zero)return true;
 // Berlekamp-Massey, locator coefficients in ascending order.
 Bytes C(65),B(65);C[0]=B[0]=1;int L=0,m=1;uint8_t b=1;
 for(int n=0;n<64;n++){uint8_t d=synd[n];for(int i=1;i<=L;i++)d^=gf.mul(C[i],synd[n-i]);if(!d){m++;continue;}
  auto old=C;auto scale=gf.div(d,b);for(int j=0;j+m<65;j++)C[j+m]^=gf.mul(scale,B[j]);
  if(2*L<=n){L=n+1-L;B=old;b=d;m=1;}else m++;
 }
 if(L<1||L>32)return false;
 std::vector<int> powers;for(int j=0;j<255;j++){uint8_t x=gf.exp[(255-j)%255],sum=0,p=1;for(int i=0;i<=L;i++){sum^=gf.mul(C[i],p);p=gf.mul(p,x);}if(!sum)powers.push_back(j);}
 if(int(powers.size())!=L)return false;
 std::vector<Bytes> a(L,Bytes(L+1));for(int r=0;r<L;r++){for(int c=0;c<L;c++)a[r][c]=gf.exp[(r*powers[c])%255];a[r][L]=synd[r];}
 for(int c=0;c<L;c++){int pivot=c;while(pivot<L&&!a[pivot][c])pivot++;if(pivot==L)return false;std::swap(a[c],a[pivot]);auto v=a[c][c];for(int j=c;j<=L;j++)a[c][j]=gf.div(a[c][j],v);
  for(int r=0;r<L;r++)if(r!=c){auto factor=a[r][c];for(int j=c;j<=L;j++)a[r][j]^=gf.mul(factor,a[c][j]);}}
 for(int i=0;i<L;i++)word[254-powers[i]]^=a[i][L];for(int i=0;i<64;i++)if(gf.eval(word,gf.exp[i]))return false;return true;
}
struct Layout {
 Grid pilot{},reserved{},mask{};std::vector<int> cells;
 Layout(){for(int y=0;y<H;y++)for(int x=0;x<W;x++){int p=y*W+x;pilot[p]=mask[p]=(x+y)%2==0;reserved[p]=!x||x==W-1||!y||y==H-1;}
  for(auto origin:std::array<std::pair<int,int>,4>{{{1,1},{W-10,1},{1,H-10},{W-10,H-10}}})for(int y=0;y<9;y++)for(int x=0;x<9;x++){
   int p=(origin.second+y)*W+origin.first+x,edge=std::min({x,y,8-x,8-y});reserved[p]=1;pilot[p]=edge%2==0&&edge<3;}
  for(int p=0;p<W*H;p++)if(!reserved[p])cells.push_back(p);
 }
};
static const Layout layout;
Grid render(const Bytes& packet){
 require(packet.size()==PACKET,"Invalid packet size");Bytes padded=packet;padded.resize(764);std::array<Bytes,4> words;
 for(int i=0;i<4;i++)words[i]=parity(Bytes(padded.begin()+i*191,padded.begin()+(i+1)*191));
 Grid grid=layout.pilot;for(size_t i=0;i<layout.cells.size();i++){int bit=i%(4*255*8),byte=bit/8;grid[layout.cells[i]]=((words[byte%4][byte/4]>>(7-bit%8))&1)^layout.mask[layout.cells[i]];}for(auto& x:grid)x*=255;return grid;
}
Bytes read(const Grid& levels){
 auto sorted=levels;std::sort(sorted.begin(),sorted.end());int dark=sorted[W*H/10],light=sorted[W*H*9/10];if(light-dark<80)return {};
 int threshold=(light+dark)/2,errors=0,total=0;for(int p=0;p<W*H;p++)if(layout.reserved[p]){total++;errors+=((levels[p]>threshold)!=bool(layout.pilot[p]));}if(errors>total*.15)return {};
 std::array<Bytes,4> words;for(auto& w:words)w.resize(255);for(int i=0;i<4*255*8;i++){int p=layout.cells[i],byte=i/8;words[byte%4][byte/4]|=((levels[p]>threshold)^layout.mask[p])<<(7-i%8);}
 Bytes packet;for(auto& w:words){if(!correct(w))return {};packet.insert(packet.end(),w.begin(),w.begin()+191);}packet.resize(PACKET);return packet;
}
Encoder::Encoder(const Bytes& data,const std::string& id):length(data.size()),sid(parseSid(id)){
 require(length>=192&&length<=512*1024,"Invalid payload size");count=std::max(2,int((length+BLOCK-1)/BLOCK));require(count<=900,"Video capacity exceeded");message=data;message.resize(count*BLOCK);initWire();codec=wirehair_encoder_create(nullptr,message.data(),message.size(),BLOCK);require(codec,"Encoder initialization failed");
}
Encoder::~Encoder(){if(codec)wirehair_free(codec);}
Bytes Encoder::packet(int index)const{
 require(index>=0&&index<frames(),"Invalid frame");Bytes out(PACKET);std::memcpy(out.data(),"BQ02",4);out[4]=2;out[5]=2;out[6]=BLOCK&255;out[7]=BLOCK>>8;std::copy(sid.begin(),sid.end(),out.begin()+8);put32(out.data()+24,index);put32(out.data()+28,count);put32(out.data()+32,length);uint32_t written=0;
 require(wirehair_encode(codec,index,out.data()+40,BLOCK,&written)==Wirehair_Success&&written==BLOCK,"Encode failed");put32(out.data()+36,crc(out));return out;
}
Grid Encoder::grid(int index)const{return render(packet(index));}
Decoder::Decoder(const std::string& id):expected(id){parseSid(id);initWire();}
Decoder::~Decoder(){if(codec)wirehair_free(codec);}
bool Decoder::feed(const Grid& levels){auto p=read(levels);return !p.empty()&&packet(p);}
bool Decoder::packet(const Bytes& p){
 if(p.size()!=PACKET)return false;auto copy=p;auto checksum=get32(p.data()+36);put32(copy.data()+36,0);if(crc(copy)!=checksum)return false;
 require(!std::memcmp(p.data(),"BQ02",4)&&p[4]==2&&p[5]==2&&(p[6]|p[7]<<8)==BLOCK,"Unsupported packet");auto sid=parseSid(expected);require(std::equal(sid.begin(),sid.end(),p.begin()+8),"Unexpected snapshot");
 auto index=get32(p.data()+24),n=get32(p.data()+28),len=get32(p.data()+32);require(len>=192&&len<=512*1024&&n==std::max(2u,(len+BLOCK-1)/BLOCK)&&index<n*2,"Invalid packet bounds");
 if(!codec){count=n;length=len;codec=wirehair_decoder_create(nullptr,count*BLOCK,BLOCK);require(codec,"Decoder initialization failed");}
 require(count==int(n)&&length==len,"Conflicting headers");auto existing=seen.find(index);if(existing!=seen.end()){require(existing->second==p,"Conflicting symbol");return !payload.empty();}seen[index]=p;
 auto result=wirehair_decode(codec,index,p.data()+40,BLOCK);require(result==Wirehair_Success||result==Wirehair_NeedMore,"Decode failed");if(result!=Wirehair_Success)return false;
 payload.resize(count*BLOCK);require(wirehair_recover(codec,payload.data(),payload.size())==Wirehair_Success,"Recovery failed");payload.resize(length);return true;
}
}
