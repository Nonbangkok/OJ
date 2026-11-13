#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "queue.h"
using namespace std;

template <typename T>
const T &CP::queue<T>::at(size_t i) const
{
  // Your code here
  return mData[mFront]; // only correct for i == 0
}

#endif
