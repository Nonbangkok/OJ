#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "pair.h"
using namespace std;

template <typename T1, typename T2>
void CP::pair<T1, T2>::normalize()
{
  // Your code here
}

template <typename T1, typename T2>
bool CP::pair<T1, T2>::sorted() const
{
  // You MAY need to edit this function
  return !(second < first);
}

#endif
