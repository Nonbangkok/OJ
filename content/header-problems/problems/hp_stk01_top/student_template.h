#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "stack.h"
using namespace std;

template <typename T>
const T &CP::stack<T>::top() const
{
  // Your code here
  return mData[0];
}

#endif
