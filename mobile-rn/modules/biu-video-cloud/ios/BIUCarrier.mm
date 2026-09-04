#import "BIUCarrier.h"
#include "Carrier.h"
@implementation BIUCarrier {
 biu::Encoder *_encoder;biu::Decoder *_decoder;NSString *_failure;
}
- (NSString *)failure {return _failure ?: @"";}
- (instancetype)initWithPayload:(NSData *)payload snapshot:(NSString *)snapshot {
 if((self=[super init]))try{auto p=(const uint8_t*)payload.bytes;_encoder=new biu::Encoder(biu::Bytes(p,p+payload.length),snapshot.UTF8String);}catch(const std::exception&){_failure=@"视频编码初始化失败";}return self;
}
- (instancetype)initWithSnapshot:(NSString *)snapshot {
 if((self=[super init]))try{_decoder=new biu::Decoder(snapshot.UTF8String);}catch(const std::exception&){_failure=@"视频解码初始化失败";}return self;
}
- (int)frames {return _encoder?_encoder->frames():0;}
- (NSData *)grid:(int)index {
 if(!_encoder)return nil;try{auto grid=_encoder->grid(index);return [NSData dataWithBytes:grid.data() length:grid.size()];}catch(const std::exception&){_failure=@"视频编码失败";return nil;}
}
- (NSData *)feed:(NSData *)levels {
 if(!_decoder||levels.length!=biu::W*biu::H)return nil;
 try{biu::Grid g;memcpy(g.data(),levels.bytes,g.size());if(!_decoder->feed(g))return nil;return [NSData dataWithBytes:_decoder->payload.data() length:_decoder->payload.size()];}
 catch(const std::exception&){_failure=@"视频数据不完整或来自其他快照";return nil;}
}
- (void)dealloc {delete _encoder;delete _decoder;}
@end
